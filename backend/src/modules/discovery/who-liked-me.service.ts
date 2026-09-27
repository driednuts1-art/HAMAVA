import { Inject, Injectable } from '@nestjs/common';
import { Prisma, SwipeAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { computeAge } from '../../common/age.util';
import { buildSafetyExclusionWhere } from './candidate-exclusion.util';
import { buildCandidateProfileFields } from './candidate-profile-fields.util';
import {
  decodeCursor,
  encodeCursor,
} from '../../common/pagination/cursor.util';
import { STORAGE_PROVIDER } from '../profile/storage/storage-provider.interface';
import type { StorageProviderInterface } from '../profile/storage/storage-provider.interface';
import { isNewMember, type DeckCandidate } from './deck.service';
import { PresenceService } from '../presence/presence.service';

const LIKE_ACTIONS: SwipeAction[] = [SwipeAction.LIKE, SwipeAction.SUPER_LIKE];

/**
 * Feature 24 (docs/requirements.md §2/§6.5): "Who Liked Me" — a real read
 * surface over data `SwipeService.recordSwipe()` has recorded since Feature
 * 3. No new write path here; a candidate's own tap-to-match-back/dismiss
 * calls the real, existing `POST /v1/discovery/swipes` directly (FR-458/459)
 * — this service is list/count/seen only.
 */
@Injectable()
export class WhoLikedMeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProviderInterface,
    private readonly presenceService: PresenceService,
  ) {}

  /**
   * FR-457: exactly `buildSafetyExclusionWhere()`'s existing exclusions,
   * reused unmodified and applied to the *liker* (the Swipe's `actor`) —
   * `swipesReceived: { none: { actorId: userId } }` already means "I
   * (userId) haven't swiped this candidate yet," the real exclusion this
   * tab needs, with zero new logic.
   */
  private async likerWhere(userId: string): Promise<Prisma.UserWhereInput> {
    const viewer = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { livenessStatus: true },
    });
    return buildSafetyExclusionWhere(userId, viewer.livenessStatus);
  }

  async list(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ candidates: DeckCandidate[]; nextCursor: string | null }> {
    const [actorWhere, viewer] = await Promise.all([
      this.likerWhere(userId),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { showLastActiveStatus: true },
      }),
    ]);

    const cursorWhere: Prisma.SwipeWhereInput = cursor
      ? (() => {
          const c = decodeCursor(cursor);
          return {
            OR: [
              { createdAt: { lt: c.sortKey } },
              { createdAt: c.sortKey, id: { lt: c.id } },
            ],
          };
        })()
      : {};

    // FR-456: ordered most-recent-like-first on the real Swipe row, not the
    // candidate's own profile createdAt.
    const likeRows = await this.prisma.swipe.findMany({
      where: {
        targetId: userId,
        action: { in: LIKE_ACTIONS },
        actor: actorWhere,
        ...cursorWhere,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: {
        actor: { include: { photos: { orderBy: { position: 'asc' } } } },
      },
    });

    // FR-486: one batched Redis round trip for the whole page.
    const onlineMap = await this.presenceService.getOnlineMap(
      likeRows.map((row) => row.actor.id),
    );

    const candidates: DeckCandidate[] = await Promise.all(
      likeRows.map(async (row) => {
        const u = row.actor;
        return {
          id: u.id,
          displayName: u.displayName,
          age: u.birthDate ? computeAge(u.birthDate) : null,
          city: u.city,
          bio: u.bio,
          interests: u.interests,
          verified: u.livenessStatus,
          isNewMember: isNewMember(u.createdAt),
          presence: this.presenceService.buildPresenceField(
            viewer.showLastActiveStatus,
            u.showLastActiveStatus,
            onlineMap.get(u.id) ?? false,
            u.lastOnlineAt,
          ),
          ...buildCandidateProfileFields(u),
          photos: await Promise.all(
            u.photos.map(async (p) => ({
              id: p.id,
              position: p.position,
              url: await this.storage.getUrl(p.storageKey),
            })),
          ),
          likedWith:
            row.action === SwipeAction.SUPER_LIKE ? 'SUPER_LIKE' : 'LIKE',
        };
      }),
    );

    const last = likeRows.at(-1);
    const nextCursor =
      last && likeRows.length === limit
        ? encodeCursor(last.createdAt, last.id)
        : null;

    return { candidates, nextCursor };
  }

  /** FR-462/463: real unseen count — everyone real (FR-457) newer than the real, per-user `whoLikedMeSeenAt`. */
  async getNewCount(userId: string): Promise<number> {
    const [actorWhere, viewer] = await Promise.all([
      this.likerWhere(userId),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { whoLikedMeSeenAt: true },
      }),
    ]);

    return this.prisma.swipe.count({
      where: {
        targetId: userId,
        action: { in: LIKE_ACTIONS },
        actor: actorWhere,
        ...(viewer.whoLikedMeSeenAt
          ? { createdAt: { gt: viewer.whoLikedMeSeenAt } }
          : {}),
      },
    });
  }

  /** FR-463: real, minimal "you've opened this tab since" marker — no fabricated read-receipt semantics beyond it. */
  async markSeen(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { whoLikedMeSeenAt: new Date() },
    });
  }
}
