import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ConversationAccessService } from '../chat/conversation-access.service';
import type { StorageProviderInterface } from '../profile/storage/storage-provider.interface';
import type { AnalyticsEventProviderInterface } from '../../common/analytics/analytics-event-provider.interface';
import { DateShareRateLimitService } from './date-share-rate-limit.service';
import { DateShareService } from './date-share.service';

const CONFIG: Record<string, number> = {
  DATE_SHARE_LINK_BUFFER_HOURS: 24,
};

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

const MATCH = { id: 'match-1', userAId: 'user-1', userBId: 'partner-1' };

describe('DateShareService', () => {
  let service: DateShareService;
  let prisma: {
    user: { findUniqueOrThrow: jest.Mock };
    dateShareLink: Record<string, jest.Mock>;
    photo: { findFirst: jest.Mock };
  };
  let crypto: jest.Mocked<
    Pick<CryptoService, 'generateOpaqueToken' | 'hashShareToken'>
  >;
  let conversationAccess: jest.Mocked<ConversationAccessService>;
  let rateLimit: jest.Mocked<DateShareRateLimitService>;
  let storage: jest.Mocked<StorageProviderInterface>;
  let analytics: jest.Mocked<AnalyticsEventProviderInterface>;

  beforeEach(() => {
    prisma = {
      user: { findUniqueOrThrow: jest.fn() },
      dateShareLink: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      photo: { findFirst: jest.fn() },
    };
    crypto = {
      generateOpaqueToken: jest.fn().mockReturnValue('raw-token'),
      hashShareToken: jest.fn().mockReturnValue('hashed-token'),
    };
    conversationAccess = {
      assertParticipant: jest.fn().mockResolvedValue(MATCH),
      otherParticipant: jest.fn(
        (match: { userAId: string; userBId: string }, userId: string) =>
          match.userAId === userId ? match.userBId : match.userAId,
      ),
    } as unknown as jest.Mocked<ConversationAccessService>;
    rateLimit = {
      enforceCreation: jest.fn().mockResolvedValue(undefined),
      enforceLookup: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DateShareRateLimitService>;
    storage = {
      save: jest.fn(),
      read: jest.fn(),
      delete: jest.fn(),
      getUrl: jest.fn().mockResolvedValue('https://storage.example/signed-url'),
    };
    analytics = { track: jest.fn().mockResolvedValue(undefined) };

    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new DateShareService(
      prisma as unknown as PrismaService,
      crypto as unknown as CryptoService,
      config,
      conversationAccess,
      rateLimit,
      storage,
      analytics,
    );
  });

  describe('create (FR-154..FR-159, FR-170)', () => {
    it('creates a link, computing expiresAt from datetime + buffer hours, not from now (FR-157)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        livenessStatus: true,
        allowInSafetyShares: true,
      });
      const futureDatetime = hoursFromNow(72); // three days out
      prisma.dateShareLink.create.mockResolvedValue({
        id: 'link-1',
        expiresAt: new Date(
          new Date(futureDatetime).getTime() + 24 * 60 * 60 * 1000,
        ),
      });

      const result = await service.create('user-1', 'match-1', {
        datetime: futureDatetime,
        locationText: 'Cafe X',
      });

      expect(conversationAccess.assertParticipant).toHaveBeenCalledWith(
        'match-1',
        'user-1',
      );
      expect(result.token).toBe('raw-token');
      const createCall = prisma.dateShareLink.create.mock.calls[0][0] as {
        data: { tokenHash: string; expiresAt: Date; datetime: Date };
      };
      expect(createCall.data.tokenHash).toBe('hashed-token');
      const expectedExpiry =
        new Date(futureDatetime).getTime() + 24 * 60 * 60 * 1000;
      expect(createCall.data.expiresAt.getTime()).toBe(expectedExpiry);
      // Not "expired before it happens": a naive createdAt-relative TTL
      // would put expiresAt in the past relative to a 3-day-out date.
      expect(createCall.data.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 71 * 60 * 60 * 1000,
      );
    });

    it('never persists the raw token — only its hash', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        livenessStatus: true,
        allowInSafetyShares: true,
      });
      prisma.dateShareLink.create.mockResolvedValue({
        id: 'link-1',
        expiresAt: new Date(),
      });

      await service.create('user-1', 'match-1', {
        datetime: hoursFromNow(48),
        locationText: 'Cafe X',
      });

      const createCall = prisma.dateShareLink.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(createCall.data).not.toHaveProperty('token');
      expect(Object.values(createCall.data)).not.toContain('raw-token');
    });

    it('rejects a past datetime before any token is generated (400, FR-157)', async () => {
      const pastDatetime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await expect(
        service.create('user-1', 'match-1', {
          datetime: pastDatetime,
          locationText: 'Cafe X',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(crypto.generateOpaqueToken).not.toHaveBeenCalled();
      expect(prisma.dateShareLink.create).not.toHaveBeenCalled();
    });

    it('rejects when the other participant is not verified (FR-156)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        livenessStatus: false,
        allowInSafetyShares: true,
      });
      await expect(
        service.create('user-1', 'match-1', {
          datetime: hoursFromNow(48),
          locationText: 'Cafe X',
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.dateShareLink.create).not.toHaveBeenCalled();
    });

    it('rejects when the other participant has opted out (FR-173)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        livenessStatus: true,
        allowInSafetyShares: false,
      });
      await expect(
        service.create('user-1', 'match-1', {
          datetime: hoursFromNow(48),
          locationText: 'Cafe X',
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.dateShareLink.create).not.toHaveBeenCalled();
    });

    it('enforces the per-user creation rate limit', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        livenessStatus: true,
        allowInSafetyShares: true,
      });
      rateLimit.enforceCreation.mockRejectedValue(new Error('rate limited'));
      await expect(
        service.create('user-1', 'match-1', {
          datetime: hoursFromNow(48),
          locationText: 'Cafe X',
        }),
      ).rejects.toThrow('rate limited');
      expect(prisma.dateShareLink.create).not.toHaveBeenCalled();
    });

    it('fires date_shared with no identifying properties, fail-open on analytics failure', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        livenessStatus: true,
        allowInSafetyShares: true,
      });
      prisma.dateShareLink.create.mockResolvedValue({
        id: 'link-1',
        expiresAt: new Date(),
      });
      analytics.track.mockRejectedValue(new Error('db hiccup'));

      await expect(
        service.create('user-1', 'match-1', {
          datetime: hoursFromNow(48),
          locationText: 'Cafe X',
        }),
      ).resolves.toBeDefined();
      expect(analytics.track).toHaveBeenCalledWith('date_shared', 'user-1', {});
    });
  });

  describe('list (FR-160)', () => {
    it('checks participation and never returns the token', async () => {
      prisma.dateShareLink.findMany.mockResolvedValue([
        {
          id: 'link-1',
          datetime: new Date(),
          locationText: 'Cafe X',
          expiresAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
          tokenHash: 'hashed-token',
        },
      ]);

      const result = await service.list('user-1', 'match-1');

      expect(conversationAccess.assertParticipant).toHaveBeenCalledWith(
        'match-1',
        'user-1',
      );
      expect(result[0]).not.toHaveProperty('tokenHash');
      expect(result[0]).not.toHaveProperty('token');
    });
  });

  describe('revoke (FR-161)', () => {
    it('sets revokedAt for the owner', async () => {
      prisma.dateShareLink.findUnique.mockResolvedValue({
        id: 'link-1',
        matchId: 'match-1',
        userId: 'user-1',
      });
      await service.revoke('user-1', 'match-1', 'link-1');
      expect(prisma.dateShareLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects revoking a nonexistent link (404)', async () => {
      prisma.dateShareLink.findUnique.mockResolvedValue(null);
      await expect(
        service.revoke('user-1', 'match-1', 'link-x'),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects revoking another user's link (403)", async () => {
      prisma.dateShareLink.findUnique.mockResolvedValue({
        id: 'link-1',
        matchId: 'match-1',
        userId: 'someone-else',
      });
      await expect(
        service.revoke('user-1', 'match-1', 'link-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.dateShareLink.update).not.toHaveBeenCalled();
    });

    it('rejects a linkId that belongs to a different match (404)', async () => {
      prisma.dateShareLink.findUnique.mockResolvedValue({
        id: 'link-1',
        matchId: 'a-different-match',
        userId: 'user-1',
      });
      await expect(
        service.revoke('user-1', 'match-1', 'link-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('lookup (FR-162..FR-167)', () => {
    function validLink(overrides: Record<string, unknown> = {}) {
      return {
        userId: 'user-1',
        datetime: new Date('2026-09-01T18:00:00.000Z'),
        locationText: 'Cafe X',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        revokedAt: null,
        user: { displayName: 'Sara' },
        match: {
          userAId: 'user-1',
          userBId: 'partner-1',
          userA: { displayName: 'Sara', livenessStatus: true },
          userB: { displayName: 'Ali', livenessStatus: true },
        },
        ...overrides,
      };
    }

    it('enforces the per-IP rate limit before anything else', async () => {
      rateLimit.enforceLookup.mockRejectedValue(new Error('rate limited'));
      await expect(service.lookup('tok', '1.2.3.4')).rejects.toThrow(
        'rate limited',
      );
      expect(prisma.dateShareLink.findUnique).not.toHaveBeenCalled();
    });

    it('returns exactly the whitelisted fields for a valid link (FR-165)', async () => {
      prisma.dateShareLink.findUnique.mockResolvedValue(validLink());
      prisma.photo.findFirst.mockResolvedValue({ storageKey: 'key-1' });

      const result = await service.lookup('tok', '1.2.3.4');

      expect(result).toEqual({
        sharerDisplayName: 'Sara',
        partnerDisplayName: 'Ali',
        partnerPhotoUrl: 'https://storage.example/signed-url',
        datetime: validLink().datetime,
        locationText: 'Cafe X',
      });
      expect(storage.getUrl).toHaveBeenCalledWith('key-1');
    });

    it('resolves the partner correctly regardless of which side the sharer is on', async () => {
      prisma.dateShareLink.findUnique.mockResolvedValue(
        // sharer is userB (partner-1) this time — user (the joined sharer
        // row) must be consistent with that, same as it would be for a real row.
        validLink({ userId: 'partner-1', user: { displayName: 'Ali' } }),
      );
      prisma.photo.findFirst.mockResolvedValue(null);

      const result = await service.lookup('tok', '1.2.3.4');

      expect(result.sharerDisplayName).toBe('Ali');
      expect(result.partnerDisplayName).toBe('Sara');
    });

    it('returns null partnerPhotoUrl when the partner has no photo, rather than throwing', async () => {
      prisma.dateShareLink.findUnique.mockResolvedValue(validLink());
      prisma.photo.findFirst.mockResolvedValue(null);

      const result = await service.lookup('tok', '1.2.3.4');
      expect(result.partnerPhotoUrl).toBeNull();
    });

    it('a token that matches no row returns a generic 404 (FR-164)', async () => {
      prisma.dateShareLink.findUnique.mockResolvedValue(null);
      await expect(service.lookup('tok', '1.2.3.4')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('an expired link returns the same generic 404 (FR-164)', async () => {
      prisma.dateShareLink.findUnique.mockResolvedValue(
        validLink({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.lookup('tok', '1.2.3.4')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('a revoked link returns the same generic 404 (FR-164)', async () => {
      prisma.dateShareLink.findUnique.mockResolvedValue(
        validLink({ revokedAt: new Date() }),
      );
      await expect(service.lookup('tok', '1.2.3.4')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('all three failure reasons produce byte-identical error messages (FR-164, deliberately indistinguishable)', async () => {
      const collect = async (link: unknown) => {
        prisma.dateShareLink.findUnique.mockResolvedValue(link);
        try {
          await service.lookup('tok', '1.2.3.4');
          throw new Error('should have thrown');
        } catch (err) {
          return err instanceof NotFoundException
            ? (err.getResponse() as { message: string }).message
            : 'WRONG_EXCEPTION_TYPE';
        }
      };

      const notFoundMsg = await collect(null);
      const expiredMsg = await collect(
        validLink({ expiresAt: new Date(Date.now() - 1000) }),
      );
      const revokedMsg = await collect(validLink({ revokedAt: new Date() }));

      expect(notFoundMsg).toBe(expiredMsg);
      expect(expiredMsg).toBe(revokedMsg);
    });

    it('a link whose partner is no longer verified returns the same generic 404 (FR-166)', async () => {
      prisma.dateShareLink.findUnique.mockResolvedValue(
        validLink({
          match: {
            userAId: 'user-1',
            userBId: 'partner-1',
            userA: { displayName: 'Sara', livenessStatus: true },
            userB: { displayName: 'Ali', livenessStatus: false },
          },
        }),
      );
      await expect(service.lookup('tok', '1.2.3.4')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('looks up by re-hashing the token, never a raw-token scan (FR-163)', async () => {
      prisma.dateShareLink.findUnique.mockResolvedValue(validLink());
      prisma.photo.findFirst.mockResolvedValue(null);

      await service.lookup('the-raw-token', '1.2.3.4');

      expect(crypto.hashShareToken).toHaveBeenCalledWith('the-raw-token');
      expect(prisma.dateShareLink.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: 'hashed-token' },
        }),
      );
    });
  });
});
