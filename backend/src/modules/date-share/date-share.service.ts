import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ConversationAccessService } from '../chat/conversation-access.service';
import { STORAGE_PROVIDER } from '../profile/storage/storage-provider.interface';
import type { StorageProviderInterface } from '../profile/storage/storage-provider.interface';
import { ANALYTICS_EVENT_PROVIDER } from '../../common/analytics/analytics-event-provider.interface';
import type { AnalyticsEventProviderInterface } from '../../common/analytics/analytics-event-provider.interface';
import { DateShareRateLimitService } from './date-share-rate-limit.service';
import { CreateDateShareDto } from './dto/create-date-share.dto';

export interface DateShareLinkCreated {
  id: string;
  token: string;
  expiresAt: Date;
}

export interface DateShareLinkSummary {
  id: string;
  datetime: Date;
  locationText: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface PublicDateShareView {
  sharerDisplayName: string | null;
  partnerDisplayName: string | null;
  partnerPhotoUrl: string | null;
  datetime: Date;
  locationText: string;
}

/**
 * Orchestrates FR-154..FR-167: creating/listing/revoking links (authenticated,
 * match-scoped) and the public lookup (unauthenticated, token-scoped).
 */
@Injectable()
export class DateShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly conversationAccess: ConversationAccessService,
    private readonly rateLimit: DateShareRateLimitService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProviderInterface,
    @Inject(ANALYTICS_EVENT_PROVIDER)
    private readonly analytics: AnalyticsEventProviderInterface,
  ) {}

  /** FR-154..FR-159, FR-170: create a link for a real match the caller participates in. */
  async create(
    userId: string,
    matchId: string,
    dto: CreateDateShareDto,
  ): Promise<DateShareLinkCreated> {
    // FR-155: reuses Feature 4's existing participant check exactly (404 if
    // no such match, 403 if it exists but isn't the caller's).
    const match = await this.conversationAccess.assertParticipant(
      matchId,
      userId,
    );
    const partnerId = this.conversationAccess.otherParticipant(match, userId);

    const datetime = new Date(dto.datetime);
    if (datetime.getTime() <= Date.now()) {
      // FR-157: 400, not 409 — this is a bad input value, not a conflict
      // with another user's state (contrast the two checks below).
      throw new BadRequestException(
        'datetime must be in the future — a plan for a date that already happened has no safety value.',
      );
    }

    const partner = await this.prisma.user.findUniqueOrThrow({
      where: { id: partnerId },
      select: { livenessStatus: true, allowInSafetyShares: true },
    });
    // FR-156: the feature's entire safety premise is a *verified* partner's photo.
    if (!partner.livenessStatus) {
      throw new ConflictException(
        'The other participant is not verified — a Share My Date link cannot be created yet.',
      );
    }
    // FR-173: the partner's own opt-out (FR-171) is checked at creation
    // time, alongside verification — same 409 failure shape, not a
    // separately-meaning error.
    if (!partner.allowInSafetyShares) {
      throw new ConflictException(
        'The other participant has opted out of appearing in Share My Date links.',
      );
    }

    await this.rateLimit.enforceCreation(userId);

    const bufferHours = this.config.getOrThrow<number>(
      'DATE_SHARE_LINK_BUFFER_HOURS',
    );
    // FR-157: anchored to the date's own datetime, not to now.
    const expiresAt = new Date(
      datetime.getTime() + bufferHours * 60 * 60 * 1000,
    );

    const token = this.crypto.generateOpaqueToken(); // FR-158
    const tokenHash = this.crypto.hashShareToken(token); // FR-159

    const link = await this.prisma.dateShareLink.create({
      data: {
        userId,
        matchId,
        datetime,
        locationText: dto.locationText,
        tokenHash,
        expiresAt,
      },
    });

    // FR-170: fail-open — an analytics-write hiccup must never block a real
    // link creation. No identifying properties (FR-153's discipline, reused).
    try {
      await this.analytics.track('date_shared', userId, {});
    } catch {
      // Deliberately swallowed — see ProfileService.maybeMarkProfileCompleted
      // for the identical precedent and reasoning.
    }

    return { id: link.id, token, expiresAt: link.expiresAt };
  }

  /** FR-160: the caller's own links for a match — never the raw token (already discarded). */
  async list(userId: string, matchId: string): Promise<DateShareLinkSummary[]> {
    await this.conversationAccess.assertParticipant(matchId, userId);
    const links = await this.prisma.dateShareLink.findMany({
      where: { userId, matchId },
      orderBy: { createdAt: 'desc' },
    });
    return links.map((l) => ({
      id: l.id,
      datetime: l.datetime,
      locationText: l.locationText,
      expiresAt: l.expiresAt,
      revokedAt: l.revokedAt,
      createdAt: l.createdAt,
    }));
  }

  /** FR-161: resource-level authorization — only the link's own creator may revoke it. */
  async revoke(userId: string, matchId: string, linkId: string): Promise<void> {
    const link = await this.prisma.dateShareLink.findUnique({
      where: { id: linkId },
    });
    if (!link || link.matchId !== matchId) {
      throw new NotFoundException('Date-share link not found.');
    }
    if (link.userId !== userId) {
      throw new ForbiddenException('Not your date-share link.');
    }
    await this.prisma.dateShareLink.update({
      where: { id: linkId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * FR-162..FR-167: the one public, unauthenticated read in this codebase.
   * FR-164: every failure reason (never existed, expired, revoked, partner
   * no longer verified) produces the exact same generic NotFoundException —
   * callers must never be able to distinguish why.
   */
  async lookup(token: string, ip: string): Promise<PublicDateShareView> {
    await this.rateLimit.enforceLookup(ip); // FR-169

    const tokenHash = this.crypto.hashShareToken(token); // FR-163
    const link = await this.prisma.dateShareLink.findUnique({
      where: { tokenHash },
      include: {
        user: { select: { displayName: true } },
        match: {
          select: {
            userAId: true,
            userBId: true,
            userA: { select: { displayName: true, livenessStatus: true } },
            userB: { select: { displayName: true, livenessStatus: true } },
          },
        },
      },
    });

    const genericNotFound = () =>
      new NotFoundException('This link is no longer valid.');

    if (!link) throw genericNotFound(); // FR-164
    if (link.revokedAt) throw genericNotFound(); // FR-164
    if (link.expiresAt.getTime() <= Date.now()) throw genericNotFound(); // FR-164

    const partner =
      link.match.userAId === link.userId ? link.match.userB : link.match.userA;
    const partnerId =
      link.match.userAId === link.userId
        ? link.match.userBId
        : link.match.userAId;
    // FR-166: re-checked at lookup time, not just at creation — verification
    // is not currently revocable elsewhere, but this must not assume that
    // can never change.
    if (!partner.livenessStatus) throw genericNotFound();

    const partnerPhoto = await this.prisma.photo.findFirst({
      where: { userId: partnerId },
      orderBy: { position: 'asc' },
    });
    const partnerPhotoUrl = partnerPhoto
      ? await this.storage.getUrl(partnerPhoto.storageKey) // FR-165: reuses FR-89's live-signing exactly
      : null;

    return {
      sharerDisplayName: link.user.displayName,
      partnerDisplayName: partner.displayName,
      partnerPhotoUrl,
      datetime: link.datetime,
      locationText: link.locationText,
    };
  }
}
