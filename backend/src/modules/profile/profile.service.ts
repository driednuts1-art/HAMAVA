import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ImageProcessorService } from './image-processor.service';
import { STORAGE_PROVIDER } from './storage/storage-provider.interface';
import type { StorageProviderInterface } from './storage/storage-provider.interface';
import { MALWARE_SCAN_PROVIDER } from './moderation/malware-scan-provider.interface';
import type { MalwareScanProviderInterface } from './moderation/malware-scan-provider.interface';
import { CONTENT_MODERATION_PROVIDER } from '../../common/moderation/content-moderation-provider.interface';
import type { ContentModerationProviderInterface } from '../../common/moderation/content-moderation-provider.interface';
import { ModerationFlagService } from '../../common/moderation/moderation-flag.service';
import { ModerationContentType } from '@prisma/client';
import { EMBEDDING_PROVIDER } from '../../common/ai/embedding-provider.interface';
import type { EmbeddingProviderInterface } from '../../common/ai/embedding-provider.interface';
import { ANALYTICS_EVENT_PROVIDER } from '../../common/analytics/analytics-event-provider.interface';
import type { AnalyticsEventProviderInterface } from '../../common/analytics/analytics-event-provider.interface';
import { AttributeProvenanceService } from './attribute-provenance.service';
import { isRealPromptId } from './prompts.constants';

const MIN_AGE = 18;
const MAX_AGE = 100;

/** FR-152: which endpoint made the write that completed the profile. */
export type ProfileUpdateSource = 'FORM' | 'CONVERSATIONAL';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
    private readonly imageProcessor: ImageProcessorService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProviderInterface,
    @Inject(MALWARE_SCAN_PROVIDER)
    private readonly malwareScan: MalwareScanProviderInterface,
    @Inject(CONTENT_MODERATION_PROVIDER)
    private readonly moderation: ContentModerationProviderInterface,
    private readonly moderationFlags: ModerationFlagService,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProviderInterface,
    @Inject(ANALYTICS_EVENT_PROVIDER)
    private readonly analytics: AnalyticsEventProviderInterface,
    private readonly attributeProvenance: AttributeProvenanceService,
  ) {}

  /** FR-20: technical floor only — see requirements.md Feature 2 §9 Open Items. */
  private validateAge(birthDate: Date): void {
    const now = new Date();
    let age = now.getFullYear() - birthDate.getFullYear();
    const hadBirthdayThisYear =
      now.getMonth() > birthDate.getMonth() ||
      (now.getMonth() === birthDate.getMonth() &&
        now.getDate() >= birthDate.getDate());
    if (!hadBirthdayThisYear) age--;

    if (age < MIN_AGE || age > MAX_AGE) {
      // `field` lets a client route this to the birthDate control directly
      // (Feature 15 FR-231, ProblemDetailsFilter's `field` passthrough) —
      // the same shape the bio-moderation rejection below already uses.
      throw new BadRequestException({
        field: 'birthDate',
        message: `birthDate must correspond to an age between ${MIN_AGE} and ${MAX_AGE}.`,
      });
    }
  }

  /**
   * FR-34: set once, never cleared by later edits.
   *
   * FR-152: `source` names which endpoint made *this* call — `PATCH
   * /v1/profile` (FORM, the default) or Feature 11's confirm endpoint
   * (CONVERSATIONAL) — and is recorded on the `profile_completed` event
   * only if this specific call is the one that actually crosses the
   * completion threshold (never re-fired on a later edit, matching this
   * method's own "set once" semantics).
   */
  private async maybeMarkProfileCompleted(
    userId: string,
    source: ProfileUpdateSource,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { photos: true },
    });
    if (user.profileCompletedAt) return;
    // FR-435 (Feature 24): a real, deliberate behavior change to an
    // already-shipped gate — at least 2 real prompt answers are now part of
    // "a complete profile," not decorative. `promptAnswers` is a real Json?
    // column (FR-432), so its shape is asserted here, not trusted blindly.
    const promptAnswerCount = Array.isArray(user.promptAnswers)
      ? user.promptAnswers.length
      : 0;
    if (
      user.displayName &&
      user.birthDate &&
      user.photos.length > 0 &&
      promptAnswerCount >= 2
    ) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { profileCompletedAt: new Date() },
      });
      // FR-150/152/153: fail-open — an analytics-write hiccup must never
      // block a real profile completion. Properties carry only `source`,
      // never any actual field value (FR-153).
      try {
        await this.analytics.track('profile_completed', userId, { source });
      } catch (err) {
        this.logger.warn(
          `Could not record profile_completed analytics event for user ${userId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /**
   * Feature 29 (FR-503): real, minimal one-time seen-marker — modeled
   * directly on who-liked-me.service.ts's own markSeen(). No partial-credit
   * "saw N of 4 slides" state; either dismissed for good, or not yet.
   */
  async markWelcomeTourSeen(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { hasSeenWelcomeTour: true },
    });
  }

  /** FR-91: photo URLs are generated fresh on every call — never persisted (Feature 7). */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { photos: { orderBy: { position: 'asc' } } },
    });
    const photos = await Promise.all(
      user.photos.map(async (p) => ({
        id: p.id,
        position: p.position,
        url: await this.storage.getUrl(p.storageKey),
      })),
    );
    return {
      displayName: user.displayName,
      birthDate: user.birthDate,
      city: user.city,
      bio: user.bio,
      interests: user.interests,
      gender: user.gender,
      datingIntent: user.datingIntent,
      profileCompletedAt: user.profileCompletedAt,
      // Feature 29 (FR-504).
      hasSeenWelcomeTour: user.hasSeenWelcomeTour,
      photos,
      // Feature 24: real profile depth — all optional, all returned as-is.
      promptAnswers: (user.promptAnswers ?? []) as {
        promptId: string;
        answer: string;
      }[],
      height: user.height,
      education: user.education,
      exerciseHabit: user.exerciseHabit,
      hasKids: user.hasKids,
      zodiacSign: user.zodiacSign,
      politicalView: user.politicalView,
      hometown: user.hometown,
      languages: user.languages,
      // FR-451: the caller's own read of their own profile always sees the
      // real underlying values, regardless of hideDrinkingSmoking — that
      // flag only ever affects what *other* users' reads (DeckCandidate,
      // who-liked-me) see, never the owner's own edit screen.
      drinking: user.drinking,
      smoking: user.smoking,
      hideDrinkingSmoking: user.hideDrinkingSmoking,
    };
  }

  /**
   * FR-19..FR-24, FR-33: partial update of profile fields.
   *
   * `source` (FR-152) defaults to `'FORM'` for the direct `PATCH
   * /v1/profile` call — Feature 11's confirm endpoint is the only other
   * caller, and passes `'CONVERSATIONAL'` explicitly. This is the exact
   * "no separate, looser code path" write path FR-141 requires: every
   * validation/moderation/age check below runs identically regardless of
   * `source`.
   */
  /**
   * FR-286..FR-288 (Feature 21): `confidenceByField` is only ever populated
   * by the conversational-setup caller (the one real AI-extraction path that
   * writes to this method) — plain `PATCH /v1/profile` calls never pass it,
   * and `updateProfile()`'s own contract/behavior is unchanged for that
   * caller either way. Purely additive.
   */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    source: ProfileUpdateSource = 'FORM',
    confidenceByField?: Partial<Record<string, number>>,
  ) {
    let birthDate: Date | undefined;
    if (dto.birthDate !== undefined) {
      birthDate = new Date(dto.birthDate);
      this.validateAge(birthDate);
    }

    if (dto.bio !== undefined) {
      const result = await this.moderation.moderateText(dto.bio);
      if (!result.approved) {
        await this.auditLog.record({
          actorId: userId,
          action: 'PROFILE_TEXT_MODERATION_REJECTED',
          metadata: { field: 'bio', reason: result.reason },
        });
        // FR-97: retained for human review — otherwise the rejected bio is
        // gone forever the instant this request fails.
        await this.moderationFlags.record({
          userId,
          contentType: ModerationContentType.BIO_TEXT,
          textContent: dto.bio,
          reason: result.reason,
        });
        throw new UnprocessableEntityException({
          field: 'bio',
          message: result.reason ?? 'Content did not pass moderation.',
        });
      }
    }

    // FR-434 (Feature 24): promptAnswers gets the exact same real
    // moderation pipeline as bio — no new unmoderated free-text surface.
    // "No duplicate promptId" is a cross-item check the DTO's own per-item
    // @IsIn can't express, done here; "promptId is a real id from the fixed
    // list" is already enforced by the DTO before this method ever runs —
    // re-asserted defensively since prisma.user.update below trusts this
    // array's shape directly.
    if (dto.promptAnswers !== undefined) {
      const ids = dto.promptAnswers.map((p) => p.promptId);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException({
          field: 'promptAnswers',
          message: 'Duplicate promptId in promptAnswers.',
        });
      }
      for (const id of ids) {
        if (!isRealPromptId(id)) {
          throw new BadRequestException({
            field: 'promptAnswers',
            message: `Unknown promptId: ${id}`,
          });
        }
      }
      for (const { answer } of dto.promptAnswers) {
        const result = await this.moderation.moderateText(answer);
        if (!result.approved) {
          await this.auditLog.record({
            actorId: userId,
            action: 'PROFILE_TEXT_MODERATION_REJECTED',
            metadata: { field: 'promptAnswers', reason: result.reason },
          });
          await this.moderationFlags.record({
            userId,
            contentType: ModerationContentType.BIO_TEXT,
            textContent: answer,
            reason: result.reason,
          });
          throw new UnprocessableEntityException({
            field: 'promptAnswers',
            message: result.reason ?? 'Content did not pass moderation.',
          });
        }
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: dto.displayName,
        birthDate,
        city: dto.city,
        bio: dto.bio,
        interests: dto.interests,
        gender: dto.gender,
        datingIntent: dto.datingIntent,
        // Feature 24
        promptAnswers: dto.promptAnswers as unknown as Prisma.InputJsonValue,
        height: dto.height,
        education: dto.education,
        exerciseHabit: dto.exerciseHabit,
        hasKids: dto.hasKids,
        zodiacSign: dto.zodiacSign,
        politicalView: dto.politicalView,
        hometown: dto.hometown,
        languages: dto.languages,
        drinking: dto.drinking,
        smoking: dto.smoking,
        hideDrinkingSmoking: dto.hideDrinkingSmoking,
      },
    });

    if (dto.bio !== undefined || dto.interests !== undefined) {
      await this.recomputeBioEmbedding(userId); // FR-112
    }

    // FR-286: one provenance row per field actually present in this write.
    const allProfileFields = [
      'displayName',
      'birthDate',
      'city',
      'bio',
      'interests',
      'gender',
      'datingIntent',
      'promptAnswers',
      'height',
      'education',
      'exerciseHabit',
      'hasKids',
      'zodiacSign',
      'politicalView',
      'hometown',
      'languages',
      'drinking',
      'smoking',
      'hideDrinkingSmoking',
    ] as const;
    const writtenFields: string[] = allProfileFields.filter(
      (f) => dto[f] !== undefined,
    );
    if (writtenFields.length > 0) {
      await this.attributeProvenance.recordMany(
        userId,
        writtenFields,
        source === 'CONVERSATIONAL' ? 'USER_CONFIRMED' : 'USER_ENTERED',
        confidenceByField,
      );
    }

    await this.maybeMarkProfileCompleted(userId, source);
    return this.getProfile(userId);
  }

  /**
   * FR-112: precompute `User.bioEmbedding` in the same request that already
   * calls `moderateText()` on bio changes — reads back the just-written
   * bio/interests (rather than merging `dto` with prior state by hand) so
   * this is correct whether only one of the two fields changed or both did.
   *
   * Deliberately resilient, not fail-closed: if the embedding vendor call
   * fails, this logs a warning and the profile update still succeeds —
   * failing the user's bio save because an unrelated ranking feature's
   * vendor is briefly down would be a worse outcome than a stale/missing
   * embedding, which self-heals on their next edit (or the one-time backfill
   * script for pre-existing rows). This is a different call site from
   * FR-116's fail-open AI-search vendor-failure handling — that's about a
   * search *request* failing gracefully; this is about a profile *write*
   * not being held hostage by a ranking feature it doesn't depend on.
   */
  private async recomputeBioEmbedding(userId: string): Promise<void> {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { bio: true, interests: true },
    });
    const text = [current.bio ?? '', current.interests.join(', ')]
      .filter((part) => part.length > 0)
      .join('\n');

    if (text.length === 0) {
      await this.prisma.$executeRaw(
        Prisma.sql`UPDATE users SET "bioEmbedding" = NULL WHERE id = ${userId}`,
      );
      return;
    }

    try {
      const embedding = await this.embeddingProvider.embed(text);
      const vectorLiteral = `[${embedding.join(',')}]`;
      await this.prisma.$executeRaw(
        Prisma.sql`UPDATE users SET "bioEmbedding" = ${vectorLiteral}::vector WHERE id = ${userId}`,
      );
    } catch (err) {
      this.logger.warn(
        `Could not recompute bioEmbedding for user ${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** FR-25..FR-31: validate, scan, re-encode, moderate, then persist an uploaded photo. */
  async uploadPhoto(userId: string, file: Express.Multer.File) {
    const maxPhotos = this.config.getOrThrow<number>('PROFILE_MAX_PHOTOS');
    const photoCount = await this.prisma.photo.count({ where: { userId } });
    if (photoCount >= maxPhotos) {
      throw new ConflictException(
        `A profile can have at most ${maxPhotos} photos.`,
      );
    }

    const scanResult = await this.malwareScan.scan(file.buffer);
    if (!scanResult.clean) {
      await this.auditLog.record({
        actorId: userId,
        action: 'PROFILE_PHOTO_MALWARE_DETECTED',
        metadata: { reason: scanResult.reason },
      });
      throw new UnprocessableEntityException('Upload failed a malware scan.');
    }

    // Re-encoding also validates that the upload is a genuine, decodable
    // image in an accepted format (FR-25) — throws UnsupportedMediaTypeException otherwise.
    const processed = await this.imageProcessor.reencodeToWebp(file.buffer);

    const moderationResult = await this.moderation.moderateImage(processed);
    if (!moderationResult.approved) {
      await this.auditLog.record({
        actorId: userId,
        action: 'PROFILE_PHOTO_MODERATION_REJECTED',
        metadata: { reason: moderationResult.reason },
      });
      // FR-97: the rejected image is never saved as a real Photo — quarantine
      // it under its own key so a human reviewer can actually see it later.
      await this.moderationFlags.record({
        userId,
        contentType: ModerationContentType.PHOTO,
        imageData: processed,
        reason: moderationResult.reason,
      });
      throw new UnprocessableEntityException(
        moderationResult.reason ?? 'Image did not pass moderation.',
      );
    }

    const key = `${randomUUID()}.webp`;
    await this.storage.save(key, processed, 'image/webp');

    const maxPosition = await this.prisma.photo.aggregate({
      where: { userId },
      _max: { position: true },
    });
    const photo = await this.prisma.photo.create({
      data: {
        userId,
        storageKey: key,
        position: (maxPosition._max.position ?? -1) + 1,
      },
    });

    // Photos never come from the conversational flow (requirements.md
    // Feature 11 §4, out of scope) — always FORM.
    await this.maybeMarkProfileCompleted(userId, 'FORM');
    return { id: photo.id, position: photo.position };
  }

  /** FR-32: resource-level authorization — a user may only delete their own photo. */
  async deletePhoto(userId: string, photoId: string): Promise<void> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo) throw new NotFoundException('Photo not found.');
    if (photo.userId !== userId)
      throw new ForbiddenException('Not your photo.');

    await this.storage.delete(photo.storageKey);
    await this.prisma.photo.delete({ where: { id: photoId } });
  }
}
