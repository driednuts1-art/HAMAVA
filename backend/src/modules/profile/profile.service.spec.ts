import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import type { ImageProcessorService } from './image-processor.service';
import { ProfileService } from './profile.service';
import type { StorageProviderInterface } from './storage/storage-provider.interface';
import type { MalwareScanProviderInterface } from './moderation/malware-scan-provider.interface';
import type { ContentModerationProviderInterface } from '../../common/moderation/content-moderation-provider.interface';
import type { ModerationFlagService } from '../../common/moderation/moderation-flag.service';
import type { EmbeddingProviderInterface } from '../../common/ai/embedding-provider.interface';
import type { AnalyticsEventProviderInterface } from '../../common/analytics/analytics-event-provider.interface';
import type { AttributeProvenanceService } from './attribute-provenance.service';

const CONFIG: Record<string, number> = {
  PROFILE_MAX_PHOTOS: 6,
};

function yearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString();
}

describe('ProfileService', () => {
  let service: ProfileService;
  let prisma: {
    user: Record<string, jest.Mock>;
    photo: Record<string, jest.Mock>;
    $executeRaw: jest.Mock;
  };
  let auditLog: { record: jest.Mock };
  let imageProcessor: jest.Mocked<ImageProcessorService>;
  let storage: jest.Mocked<StorageProviderInterface>;
  let malwareScan: jest.Mocked<MalwareScanProviderInterface>;
  let moderation: jest.Mocked<ContentModerationProviderInterface>;
  let moderationFlags: { record: jest.Mock };
  let embeddingProvider: jest.Mocked<EmbeddingProviderInterface>;
  let analytics: jest.Mocked<AnalyticsEventProviderInterface>;
  let attributeProvenance: { recordMany: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      photo: {
        count: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    imageProcessor = { reencodeToWebp: jest.fn() };
    storage = {
      save: jest.fn(),
      read: jest.fn(),
      delete: jest.fn(),
      getUrl: jest.fn().mockResolvedValue('https://storage.example/signed-url'),
    };
    malwareScan = { scan: jest.fn().mockResolvedValue({ clean: true }) };
    moderation = {
      moderateImage: jest.fn().mockResolvedValue({ approved: true }),
      moderateText: jest.fn().mockResolvedValue({ approved: true }),
    };
    moderationFlags = { record: jest.fn().mockResolvedValue({ id: 'flag-1' }) };
    embeddingProvider = {
      embed: jest.fn().mockResolvedValue(new Array(1536).fill(0.01)),
    };
    analytics = { track: jest.fn().mockResolvedValue(undefined) };
    attributeProvenance = {
      recordMany: jest.fn().mockResolvedValue(undefined),
    };

    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new ProfileService(
      prisma as unknown as PrismaService,
      config,
      auditLog as unknown as AuditLogService,
      imageProcessor,
      storage,
      malwareScan,
      moderation,
      moderationFlags as unknown as ModerationFlagService,
      embeddingProvider,
      analytics,
      attributeProvenance as unknown as AttributeProvenanceService,
    );
  });

  describe('getProfile', () => {
    it('resolves a fresh presigned URL for every photo, not a stored one (FR-91)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: null,
        city: null,
        bio: null,
        interests: [],
        gender: null,
        datingIntent: null,
        profileCompletedAt: null,
        photos: [
          { id: 'photo-1', position: 0, storageKey: 'key-1' },
          { id: 'photo-2', position: 1, storageKey: 'key-2' },
        ],
      });

      const result = await service.getProfile('user-1');

      expect(result.photos).toEqual([
        {
          id: 'photo-1',
          position: 0,
          url: 'https://storage.example/signed-url',
        },
        {
          id: 'photo-2',
          position: 1,
          url: 'https://storage.example/signed-url',
        },
      ]);
      expect(storage.getUrl).toHaveBeenCalledWith('key-1');
      expect(storage.getUrl).toHaveBeenCalledWith('key-2');
    });

    it('includes the real hasSeenWelcomeTour flag (Feature 29, FR-504)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: null,
        city: null,
        bio: null,
        interests: [],
        gender: null,
        datingIntent: null,
        profileCompletedAt: null,
        hasSeenWelcomeTour: true,
        photos: [],
      });

      const result = await service.getProfile('user-1');

      expect(result.hasSeenWelcomeTour).toBe(true);
    });
  });

  describe('markWelcomeTourSeen (Feature 29, FR-503)', () => {
    it('sets hasSeenWelcomeTour to true for the real caller, modeled on who-liked-me markSeen', async () => {
      await service.markWelcomeTourSeen('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { hasSeenWelcomeTour: true },
      });
    });
  });

  describe('updateProfile', () => {
    it('rejects an under-18 birthDate without touching the DB (FR-20)', async () => {
      await expect(
        service.updateProfile('user-1', { birthDate: yearsAgo(10) }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an implausible birthDate over 100 (FR-20)', async () => {
      await expect(
        service.updateProfile('user-1', { birthDate: yearsAgo(150) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects bio text that fails moderation and audit-logs it (FR-33)', async () => {
      moderation.moderateText.mockResolvedValue({
        approved: false,
        reason: 'scam pattern',
      });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ photos: [] });

      await expect(
        service.updateProfile('user-1', { bio: 'suspicious text' }),
      ).rejects.toThrow();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PROFILE_TEXT_MODERATION_REJECTED' }),
      );
      // FR-97: retained for human review — otherwise gone the instant this request fails.
      expect(moderationFlags.record).toHaveBeenCalledWith({
        userId: 'user-1',
        contentType: 'BIO_TEXT',
        textContent: 'suspicious text',
        reason: 'scam pattern',
      });
    });

    it('accepts a valid update and does not mark complete without a photo (FR-34)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: new Date(yearsAgo(25)),
        photos: [],
        profileCompletedAt: null,
        interests: [],
      });

      await service.updateProfile('user-1', {
        displayName: 'Sara',
        birthDate: yearsAgo(25),
      });

      expect(prisma.user.update).toHaveBeenCalledTimes(1); // only the field update, no completion update
    });

    describe('attribute provenance (FR-286)', () => {
      it('records USER_ENTERED provenance for exactly the fields present in the write', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          displayName: 'Sara',
          birthDate: new Date(yearsAgo(25)),
          photos: [],
          profileCompletedAt: null,
          interests: [],
        });

        await service.updateProfile('user-1', {
          displayName: 'Sara',
          birthDate: yearsAgo(25),
        });

        expect(attributeProvenance.recordMany).toHaveBeenCalledWith(
          'user-1',
          ['displayName', 'birthDate'],
          'USER_ENTERED',
          undefined,
        );
      });

      it('records USER_CONFIRMED provenance with the caller-supplied confidence when source is CONVERSATIONAL', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          displayName: 'Sara',
          birthDate: new Date(yearsAgo(25)),
          photos: [],
          profileCompletedAt: null,
          interests: [],
        });

        await service.updateProfile(
          'user-1',
          { city: 'Tehran' },
          'CONVERSATIONAL',
          { city: 0.9 },
        );

        expect(attributeProvenance.recordMany).toHaveBeenCalledWith(
          'user-1',
          ['city'],
          'USER_CONFIRMED',
          { city: 0.9 },
        );
      });

      it('does not call recordMany when the write touches no tracked profile field', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          displayName: 'Sara',
          birthDate: new Date(yearsAgo(25)),
          photos: [],
          profileCompletedAt: null,
          interests: [],
        });

        await service.updateProfile('user-1', {});

        expect(attributeProvenance.recordMany).not.toHaveBeenCalled();
      });
    });

    it('marks profileCompletedAt once displayName + birthDate + a photo + 2 prompt answers all exist (FR-34, FR-435)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: new Date(yearsAgo(25)),
        photos: [{ id: 'photo-1' }],
        profileCompletedAt: null,
        interests: [],
        promptAnswers: [
          { promptId: 'best-night', answer: "When I'm out with friends" },
          { promptId: 'never-say-no', answer: 'A spontaneous weekend trip' },
        ],
      });

      await service.updateProfile('user-1', { displayName: 'Sara' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { profileCompletedAt: expect.any(Date) },
      });
    });

    it('does NOT mark profileCompletedAt with fewer than 2 prompt answers, even with displayName + birthDate + a photo (FR-435)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: new Date(yearsAgo(25)),
        photos: [{ id: 'photo-1' }],
        profileCompletedAt: null,
        interests: [],
        promptAnswers: [{ promptId: 'best-night', answer: 'Just one' }],
      });

      await service.updateProfile('user-1', { displayName: 'Sara' });

      expect(prisma.user.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { profileCompletedAt: expect.any(Date) },
        }),
      );
    });

    it('does NOT mark profileCompletedAt when promptAnswers is missing/null (FR-435 defensive case)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: new Date(yearsAgo(25)),
        photos: [{ id: 'photo-1' }],
        profileCompletedAt: null,
        interests: [],
        promptAnswers: null,
      });

      await service.updateProfile('user-1', { displayName: 'Sara' });

      expect(prisma.user.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { profileCompletedAt: expect.any(Date) },
        }),
      );
    });

    describe('profile_completed analytics event (FR-150..FR-153)', () => {
      it('fires with source: FORM by default when the update crosses the completion threshold', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          displayName: 'Sara',
          birthDate: new Date(yearsAgo(25)),
          photos: [{ id: 'photo-1' }],
          profileCompletedAt: null,
          interests: [],
          promptAnswers: [
            { promptId: 'best-night', answer: "When I'm out with friends" },
            { promptId: 'never-say-no', answer: 'A spontaneous weekend trip' },
          ],
        });

        await service.updateProfile('user-1', { displayName: 'Sara' });

        expect(analytics.track).toHaveBeenCalledWith(
          'profile_completed',
          'user-1',
          { source: 'FORM' },
        );
      });

      it('fires with source: CONVERSATIONAL when the caller explicitly passes it', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          displayName: 'Sara',
          birthDate: new Date(yearsAgo(25)),
          photos: [{ id: 'photo-1' }],
          profileCompletedAt: null,
          interests: [],
          promptAnswers: [
            { promptId: 'best-night', answer: "When I'm out with friends" },
            { promptId: 'never-say-no', answer: 'A spontaneous weekend trip' },
          ],
        });

        await service.updateProfile(
          'user-1',
          { displayName: 'Sara' },
          'CONVERSATIONAL',
        );

        expect(analytics.track).toHaveBeenCalledWith(
          'profile_completed',
          'user-1',
          { source: 'CONVERSATIONAL' },
        );
      });

      it('never fires when the update does not cross the completion threshold', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          displayName: 'Sara',
          birthDate: new Date(yearsAgo(25)),
          photos: [],
          profileCompletedAt: null,
          interests: [],
        });

        await service.updateProfile('user-1', {
          displayName: 'Sara',
          birthDate: yearsAgo(25),
        });

        expect(analytics.track).not.toHaveBeenCalled();
      });

      it('never re-fires once profileCompletedAt is already set', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          displayName: 'Sara',
          birthDate: new Date(yearsAgo(25)),
          photos: [{ id: 'photo-1' }],
          profileCompletedAt: new Date('2020-01-01'),
          interests: [],
        });

        await service.updateProfile('user-1', { city: 'Tehran' });

        expect(analytics.track).not.toHaveBeenCalled();
      });

      it('does not fail the profile update when the analytics write throws (fail-open)', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          displayName: 'Sara',
          birthDate: new Date(yearsAgo(25)),
          photos: [{ id: 'photo-1' }],
          profileCompletedAt: null,
          interests: [],
        });
        analytics.track.mockRejectedValue(new Error('db hiccup'));

        await expect(
          service.updateProfile('user-1', { displayName: 'Sara' }),
        ).resolves.toBeDefined();
      });
    });

    it('does not re-mark profileCompletedAt once already set (FR-34)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: new Date(yearsAgo(25)),
        photos: [{ id: 'photo-1' }],
        profileCompletedAt: new Date('2020-01-01'),
        interests: [],
      });

      await service.updateProfile('user-1', { city: 'Tehran' });

      expect(prisma.user.update).toHaveBeenCalledTimes(1); // only the field update
    });

    it('recomputes bioEmbedding when bio changes (FR-112)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: new Date(yearsAgo(25)),
        photos: [],
        profileCompletedAt: null,
        bio: 'Into books and sports',
        interests: [],
      });

      await service.updateProfile('user-1', { bio: 'Into books and sports' });

      expect(embeddingProvider.embed).toHaveBeenCalledWith(
        'Into books and sports',
      );
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('recomputes bioEmbedding when only interests change, with no bio in the request (FR-112)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: new Date(yearsAgo(25)),
        photos: [],
        profileCompletedAt: null,
        bio: null,
        interests: ['books', 'sports'],
      });

      await service.updateProfile('user-1', {
        interests: ['books', 'sports'],
      });

      expect(embeddingProvider.embed).toHaveBeenCalledWith('books, sports');
    });

    it('clears bioEmbedding to NULL instead of embedding empty text', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: new Date(yearsAgo(25)),
        photos: [],
        profileCompletedAt: null,
        bio: null,
        interests: [],
      });

      await service.updateProfile('user-1', { bio: undefined, interests: [] });

      expect(embeddingProvider.embed).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('does not fail the profile update when the embedding vendor throws (deliberately resilient, not fail-closed)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: new Date(yearsAgo(25)),
        photos: [],
        profileCompletedAt: null,
        bio: 'New text',
        interests: [],
      });
      // OpenAiEmbeddingProvider's own real fail-closed contract throws
      // ServiceUnavailableException, not a bare Error — matching that shape
      // keeps this test accurate even though recomputeBioEmbedding's own
      // catch block doesn't currently discriminate by type.
      embeddingProvider.embed.mockRejectedValue(
        new ServiceUnavailableException('vendor down'),
      );

      await expect(
        service.updateProfile('user-1', { bio: 'New text' }),
      ).resolves.toBeDefined();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('never touches bioEmbedding when neither bio nor interests changed', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: new Date(yearsAgo(25)),
        photos: [],
        profileCompletedAt: null,
        interests: [],
      });

      await service.updateProfile('user-1', { city: 'Tehran' });

      expect(embeddingProvider.embed).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('uploadPhoto', () => {
    const file = {
      buffer: Buffer.from('fake-image-bytes'),
    } as Express.Multer.File;

    it('rejects once the max-photos limit is reached, before any processing (FR-30)', async () => {
      prisma.photo.count.mockResolvedValue(6);
      await expect(service.uploadPhoto('user-1', file)).rejects.toThrow(
        ConflictException,
      );
      expect(malwareScan.scan).not.toHaveBeenCalled();
    });

    it('rejects an unclean upload and audit-logs it, before re-encoding (FR-28)', async () => {
      prisma.photo.count.mockResolvedValue(0);
      malwareScan.scan.mockResolvedValue({
        clean: false,
        reason: 'eicar-test',
      });

      await expect(service.uploadPhoto('user-1', file)).rejects.toThrow();
      expect(imageProcessor.reencodeToWebp).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PROFILE_PHOTO_MALWARE_DETECTED' }),
      );
    });

    it('rejects an image that fails moderation, after re-encoding but before storage (FR-29)', async () => {
      prisma.photo.count.mockResolvedValue(0);
      imageProcessor.reencodeToWebp.mockResolvedValue(Buffer.from('processed'));
      moderation.moderateImage.mockResolvedValue({
        approved: false,
        reason: 'nudity',
      });

      await expect(service.uploadPhoto('user-1', file)).rejects.toThrow();
      expect(storage.save).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PROFILE_PHOTO_MODERATION_REJECTED',
        }),
      );
      // FR-97: the rejected image is quarantined for human review, since it
      // was never saved as a real Photo.
      expect(moderationFlags.record).toHaveBeenCalledWith({
        userId: 'user-1',
        contentType: 'PHOTO',
        imageData: Buffer.from('processed'),
        reason: 'nudity',
      });
    });

    it('stores the re-encoded (not original) buffer and creates a Photo row (FR-25..FR-27)', async () => {
      prisma.photo.count.mockResolvedValue(0);
      const processedBuffer = Buffer.from('processed-webp-bytes');
      imageProcessor.reencodeToWebp.mockResolvedValue(processedBuffer);
      prisma.photo.aggregate.mockResolvedValue({ _max: { position: null } });
      prisma.photo.create.mockResolvedValue({ id: 'photo-1', position: 0 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: null,
        birthDate: null,
        photos: [{ id: 'photo-1' }],
        profileCompletedAt: null,
      });

      await service.uploadPhoto('user-1', file);

      expect(storage.save).toHaveBeenCalledWith(
        expect.any(String),
        processedBuffer,
        'image/webp',
      );
      expect(prisma.photo.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', storageKey: expect.any(String), position: 0 },
      });
    });

    it('a completing photo upload always fires profile_completed with source: FORM (FR-152)', async () => {
      prisma.photo.count.mockResolvedValue(0);
      imageProcessor.reencodeToWebp.mockResolvedValue(Buffer.from('x'));
      prisma.photo.aggregate.mockResolvedValue({ _max: { position: null } });
      prisma.photo.create.mockResolvedValue({ id: 'photo-1', position: 0 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        displayName: 'Sara',
        birthDate: new Date(yearsAgo(25)),
        photos: [{ id: 'photo-1' }],
        profileCompletedAt: null,
        promptAnswers: [
          { promptId: 'best-night', answer: "When I'm out with friends" },
          { promptId: 'never-say-no', answer: 'A spontaneous weekend trip' },
        ],
      });

      await service.uploadPhoto('user-1', file);

      expect(analytics.track).toHaveBeenCalledWith(
        'profile_completed',
        'user-1',
        { source: 'FORM' },
      );
    });
  });

  describe('deletePhoto', () => {
    it('rejects deleting a photo that does not exist', async () => {
      prisma.photo.findUnique.mockResolvedValue(null);
      await expect(service.deletePhoto('user-1', 'photo-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("rejects deleting another user's photo (FR-32)", async () => {
      prisma.photo.findUnique.mockResolvedValue({
        id: 'photo-1',
        userId: 'someone-else',
        storageKey: 'k',
      });
      await expect(service.deletePhoto('user-1', 'photo-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('deletes the storage object and the DB row for the owner', async () => {
      prisma.photo.findUnique.mockResolvedValue({
        id: 'photo-1',
        userId: 'user-1',
        storageKey: 'k.webp',
      });
      await service.deletePhoto('user-1', 'photo-1');
      expect(storage.delete).toHaveBeenCalledWith('k.webp');
      expect(prisma.photo.delete).toHaveBeenCalledWith({
        where: { id: 'photo-1' },
      });
    });
  });
});
