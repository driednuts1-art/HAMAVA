import { NotFoundException } from '@nestjs/common';
import {
  ModerationContentType,
  ModerationFlagResolution,
  ModerationFlagStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { StorageProviderInterface } from '../../modules/profile/storage/storage-provider.interface';
import { ModerationFlagService } from './moderation-flag.service';

describe('ModerationFlagService', () => {
  let service: ModerationFlagService;
  let prisma: {
    moderationFlag: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let auditLog: { record: jest.Mock };
  let storage: jest.Mocked<StorageProviderInterface>;

  beforeEach(() => {
    prisma = {
      moderationFlag: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    storage = {
      save: jest.fn().mockResolvedValue(undefined),
      read: jest.fn(),
      delete: jest.fn(),
      getUrl: jest.fn().mockResolvedValue('https://storage.example/signed-url'),
    };
    service = new ModerationFlagService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
      storage,
    );
  });

  describe('record', () => {
    it('creates a flag with the text content, for BIO_TEXT/MESSAGE (FR-97)', async () => {
      prisma.moderationFlag.create.mockResolvedValue({ id: 'flag-1' });

      await service.record({
        userId: 'user-1',
        contentType: ModerationContentType.BIO_TEXT,
        textContent: 'rejected bio',
        reason: 'harassment',
      });

      expect(storage.save).not.toHaveBeenCalled();
      expect(prisma.moderationFlag.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          contentType: ModerationContentType.BIO_TEXT,
          textContent: 'rejected bio',
          quarantineStorageKey: undefined,
          reason: 'harassment',
          contextRef: undefined,
        },
      });
    });

    it('quarantines the image under a distinct "flagged/" key, for PHOTO (FR-97)', async () => {
      prisma.moderationFlag.create.mockResolvedValue({ id: 'flag-1' });
      const imageData = Buffer.from('rejected-image-bytes');

      await service.record({
        userId: 'user-1',
        contentType: ModerationContentType.PHOTO,
        imageData,
        reason: 'violence',
      });

      expect(storage.save).toHaveBeenCalledWith(
        expect.stringMatching(/^flagged\/.+\.webp$/),
        imageData,
        'image/webp',
      );
      const createCall = prisma.moderationFlag.create.mock.calls[0][0] as {
        data: { quarantineStorageKey?: string };
      };
      expect(createCall.data.quarantineStorageKey).toMatch(
        /^flagged\/.+\.webp$/,
      );
    });

    it('stores contextRef for a rejected MESSAGE', async () => {
      prisma.moderationFlag.create.mockResolvedValue({ id: 'flag-1' });
      await service.record({
        userId: 'user-1',
        contentType: ModerationContentType.MESSAGE,
        textContent: 'bad message',
        reason: 'hate',
        contextRef: 'match-1',
      });
      expect(prisma.moderationFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contextRef: 'match-1' }),
        }),
      );
    });
  });

  describe('list', () => {
    it('filters by status, orders oldest-first (FR-98)', async () => {
      prisma.moderationFlag.findMany.mockResolvedValue([]);
      await service.list(ModerationFlagStatus.PENDING_REVIEW, undefined, 30);
      expect(prisma.moderationFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: ModerationFlagStatus.PENDING_REVIEW },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 30,
        }),
      );
    });

    it('resolves a quarantineUrl for a PHOTO flag, and null when there is none', async () => {
      prisma.moderationFlag.findMany.mockResolvedValue([
        {
          id: 'flag-1',
          quarantineStorageKey: 'flagged/abc.webp',
          createdAt: new Date(),
        },
        { id: 'flag-2', quarantineStorageKey: null, createdAt: new Date() },
      ]);

      const result = await service.list(undefined, undefined, 30);

      expect(result.flags[0].quarantineUrl).toBe(
        'https://storage.example/signed-url',
      );
      expect(result.flags[1].quarantineUrl).toBeNull();
      expect(storage.getUrl).toHaveBeenCalledWith('flagged/abc.webp');
      expect(storage.getUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolve', () => {
    it('throws NotFoundException for a flag that does not exist', async () => {
      prisma.moderationFlag.findUnique.mockResolvedValue(null);
      await expect(
        service.resolve('missing', 'admin-1', ModerationFlagResolution.UPHELD),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.moderationFlag.update).not.toHaveBeenCalled();
    });

    it('sets status/resolution/resolvedAt/resolvedByAdminId and audit-logs (FR-99)', async () => {
      prisma.moderationFlag.findUnique.mockResolvedValue({ id: 'flag-1' });
      const resolved = { id: 'flag-1', status: ModerationFlagStatus.RESOLVED };
      prisma.moderationFlag.update.mockResolvedValue(resolved);

      const result = await service.resolve(
        'flag-1',
        'admin-1',
        ModerationFlagResolution.OVERTURNED,
        'false positive',
      );

      expect(result).toBe(resolved);
      expect(prisma.moderationFlag.update).toHaveBeenCalledWith({
        where: { id: 'flag-1' },
        data: {
          status: ModerationFlagStatus.RESOLVED,
          resolution: ModerationFlagResolution.OVERTURNED,
          resolutionNote: 'false positive',
          resolvedAt: expect.any(Date),
          resolvedByAdminId: 'admin-1',
        },
      });
      expect(auditLog.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        action: 'MODERATION_FLAG_RESOLVED',
        targetRef: 'flag-1',
        metadata: {
          resolution: ModerationFlagResolution.OVERTURNED,
          resolutionNote: 'false positive',
        },
      });
    });
  });
});
