import { SwipeAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { StorageProviderInterface } from '../profile/storage/storage-provider.interface';
import type { PresenceService } from '../presence/presence.service';
import { WhoLikedMeService } from './who-liked-me.service';
import { buildSafetyExclusionWhere } from './candidate-exclusion.util';
import { encodeCursor } from '../../common/pagination/cursor.util';

function makeActor(
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id,
    displayName: id,
    birthDate: new Date('1995-01-01'),
    city: null,
    bio: null,
    interests: [],
    livenessStatus: true,
    promptAnswers: [],
    height: null,
    education: null,
    exerciseHabit: null,
    hasKids: null,
    zodiacSign: null,
    politicalView: null,
    hometown: null,
    languages: [],
    drinking: null,
    smoking: null,
    hideDrinkingSmoking: false,
    photos: [],
    createdAt: new Date('2020-01-01'),
    showLastActiveStatus: true,
    lastOnlineAt: null,
    ...overrides,
  };
}

describe('WhoLikedMeService (Feature 24, FR-453..FR-463)', () => {
  let service: WhoLikedMeService;
  let prisma: {
    user: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    swipe: { findMany: jest.Mock; count: jest.Mock };
  };
  let storage: jest.Mocked<StorageProviderInterface>;
  let presenceService: {
    getOnlineMap: jest.Mock;
    buildPresenceField: jest.Mock;
  };

  const viewer = {
    livenessStatus: true,
    whoLikedMeSeenAt: null as Date | null,
    showLastActiveStatus: true,
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(viewer),
        update: jest.fn().mockResolvedValue({}),
      },
      swipe: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    storage = {
      getUrl: jest.fn().mockResolvedValue('https://example/url'),
    } as unknown as jest.Mocked<StorageProviderInterface>;
    presenceService = {
      getOnlineMap: jest.fn().mockResolvedValue(new Map()),
      buildPresenceField: jest.fn().mockReturnValue(null),
    };

    service = new WhoLikedMeService(
      prisma as unknown as PrismaService,
      storage,
      presenceService as unknown as PresenceService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('list — FR-456/FR-457', () => {
    it('queries Swipe with targetId=viewer, LIKE/SUPER_LIKE actions, and the real, unmodified safety-exclusion where reused as the actor filter', async () => {
      await service.list('viewer-1', undefined, 20);

      expect(prisma.swipe.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            targetId: 'viewer-1',
            action: { in: [SwipeAction.LIKE, SwipeAction.SUPER_LIKE] },
            // Security regression guard: this must be the exact same
            // exclusion object DeckService/AiSearchService apply — a
            // blocked pair, an already-swiped candidate, or (for an
            // unverified viewer) a VERIFIED-restricted candidate must never
            // leak into this tab either.
            actor: buildSafetyExclusionWhere('viewer-1', true),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 20,
        }),
      );
    });

    it('applies the unverified-viewer messaging-permission gate (FR-79) to the actor filter, matching the deck', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValueOnce({
        livenessStatus: false,
      });

      await service.list('viewer-1', undefined, 20);

      const calledWhere = prisma.swipe.findMany.mock.calls[0][0].where;
      expect(calledWhere.actor).toEqual(
        buildSafetyExclusionWhere('viewer-1', false),
      );
      expect(calledWhere.actor).not.toEqual(
        buildSafetyExclusionWhere('viewer-1', true),
      );
    });

    it('decodes a cursor into the same descending (createdAt, id) keyset OR clause message.service.ts uses', async () => {
      const cursor = encodeCursor(new Date('2026-01-01T05:00:00Z'), 'swipe-9');

      await service.list('viewer-1', cursor, 10);

      const calledWhere = prisma.swipe.findMany.mock.calls[0][0].where;
      expect(calledWhere.OR).toEqual([
        { createdAt: { lt: new Date('2026-01-01T05:00:00Z') } },
        { createdAt: new Date('2026-01-01T05:00:00Z'), id: { lt: 'swipe-9' } },
      ]);
    });

    it('maps each row to its actor profile plus likedWith from the real Swipe action', async () => {
      prisma.swipe.findMany.mockResolvedValue([
        {
          id: 's1',
          action: SwipeAction.SUPER_LIKE,
          createdAt: new Date('2026-01-01T02:00:00Z'),
          actor: makeActor('liker-super'),
        },
        {
          id: 's2',
          action: SwipeAction.LIKE,
          createdAt: new Date('2026-01-01T01:00:00Z'),
          actor: makeActor('liker-plain'),
        },
      ]);

      const result = await service.list('viewer-1', undefined, 20);

      expect(
        result.candidates.map((c) => ({ id: c.id, likedWith: c.likedWith })),
      ).toEqual([
        { id: 'liker-super', likedWith: 'SUPER_LIKE' },
        { id: 'liker-plain', likedWith: 'LIKE' },
      ]);
    });

    it('enforces FR-451 hideDrinkingSmoking on liker profiles the same way the deck does', async () => {
      prisma.swipe.findMany.mockResolvedValue([
        {
          id: 's1',
          action: SwipeAction.LIKE,
          createdAt: new Date('2026-01-01T02:00:00Z'),
          actor: makeActor('liker-1', {
            drinking: 'SOMETIMES',
            smoking: 'NEVER',
            hideDrinkingSmoking: true,
          }),
        },
      ]);

      const result = await service.list('viewer-1', undefined, 20);

      expect(result.candidates[0].drinking).toBeNull();
      expect(result.candidates[0].smoking).toBeNull();
    });

    it('returns nextCursor null when fewer rows than the page limit come back', async () => {
      prisma.swipe.findMany.mockResolvedValue([
        {
          id: 's1',
          action: SwipeAction.LIKE,
          createdAt: new Date('2026-01-01T02:00:00Z'),
          actor: makeActor('liker-1'),
        },
      ]);

      const result = await service.list('viewer-1', undefined, 20);
      expect(result.nextCursor).toBeNull();
    });

    it('returns a real, decodable nextCursor when the page is exactly full', async () => {
      prisma.swipe.findMany.mockResolvedValue([
        {
          id: 's1',
          action: SwipeAction.LIKE,
          createdAt: new Date('2026-01-01T02:00:00Z'),
          actor: makeActor('liker-1'),
        },
      ]);

      const result = await service.list('viewer-1', undefined, 1);
      expect(result.nextCursor).toBe(
        encodeCursor(new Date('2026-01-01T02:00:00Z'), 's1'),
      );
    });

    it('returns an empty page with no crash when the caller has no likers', async () => {
      const result = await service.list('viewer-1', undefined, 20);
      expect(result).toEqual({ candidates: [], nextCursor: null });
    });
  });

  describe('getNewCount — FR-462', () => {
    it('counts with no createdAt filter when the caller has never opened the tab', async () => {
      await service.getNewCount('viewer-1');

      expect(prisma.swipe.count).toHaveBeenCalledWith({
        where: {
          targetId: 'viewer-1',
          action: { in: [SwipeAction.LIKE, SwipeAction.SUPER_LIKE] },
          actor: buildSafetyExclusionWhere('viewer-1', true),
        },
      });
    });

    it('counts only likes newer than whoLikedMeSeenAt once the tab has been opened before', async () => {
      const seenAt = new Date('2025-12-31T00:00:00Z');
      prisma.user.findUniqueOrThrow.mockResolvedValueOnce({
        livenessStatus: true,
      });
      prisma.user.findUniqueOrThrow.mockResolvedValueOnce({
        whoLikedMeSeenAt: seenAt,
      });

      await service.getNewCount('viewer-1');

      const calledWhere = prisma.swipe.count.mock.calls[0][0].where;
      expect(calledWhere.createdAt).toEqual({ gt: seenAt });
    });
  });

  describe('markSeen — FR-463', () => {
    it('sets whoLikedMeSeenAt to the real current time', async () => {
      await service.markSeen('viewer-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'viewer-1' },
        data: { whoLikedMeSeenAt: new Date('2026-01-01T00:00:00Z') },
      });
    });
  });
});
