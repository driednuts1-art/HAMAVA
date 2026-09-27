import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { computeAge, ageRangeToBirthDateRange } from '../../common/age.util';
import {
  PreferencesService,
  EffectivePreferences,
} from './preferences.service';
import { DeckQueryDto } from './dto/deck-query.dto';
import {
  decodeRankedCursor,
  encodeRankedCursor,
} from '../../common/pagination/cursor.util';
import { buildSafetyExclusionWhere } from './candidate-exclusion.util';
import {
  buildCandidateProfileFields,
  type CandidateProfileFields,
} from './candidate-profile-fields.util';
import { STORAGE_PROVIDER } from '../profile/storage/storage-provider.interface';
import type { StorageProviderInterface } from '../profile/storage/storage-provider.interface';
import type { MatchScore } from './matching/match-score.types';
import {
  PresenceService,
  type PresenceValue,
} from '../presence/presence.service';

// Feature 27 (FR-489/FR-490): shared by every place that computes
// "is this a new member" — one definition, not one per call site.
export const NEW_MEMBER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export function isNewMember(createdAt: Date): boolean {
  return createdAt.getTime() >= Date.now() - NEW_MEMBER_WINDOW_MS;
}

export interface DeckCandidate extends CandidateProfileFields {
  id: string;
  displayName: string | null;
  age: number | null;
  city: string | null;
  bio: string | null;
  interests: string[];
  verified: boolean;
  photos: { id: string; position: number; url: string }[];
  /**
   * Feature 21 (FR-291/FR-292): only ever populated by AiSearchService's
   * real semantic ranking — the plain deck has no semantic signal to score,
   * so this stays undefined there. Purely additive/observational; does not
   * change ranking order.
   */
  matchScore?: MatchScore;
  /** Feature 24 (FR-456): only ever populated by WhoLikedMeService. */
  likedWith?: 'LIKE' | 'SUPER_LIKE';
  /** Feature 27 (FR-490): true whenever createdAt is within the last 7 days — independent of the newMembersOnly filter. */
  isNewMember: boolean;
  /** Feature 27 (FR-485/FR-486): null when either party's showLastActiveStatus is off. */
  presence: PresenceValue | null;
}

// FR-128: pragmatic cap on the hard-filtered pool considered for boost-tier
// promotion and pagination — same known-access-pattern instinct as Feature
// 9's MAX_CANDIDATES_TO_RANK, and the same accepted limitation: a candidate
// pool larger than this cap could in principle miss its own boost-tier
// promotion relative to candidates outside the cap. Revisit with real
// query-plan data if the pool ever approaches it.
const MAX_CANDIDATES_TO_TIER = 2000;

interface ViewerFacts {
  age: number | null;
  gender: Prisma.UserGetPayload<{ select: { gender: true } }>['gender'];
  datingIntent: Prisma.UserGetPayload<{
    select: { datingIntent: true };
  }>['datingIntent'];
}

/** FR-127: the literal "constrained to the requester's [booster's] own filter" check. */
function viewerSatisfiesPreferences(
  viewer: ViewerFacts,
  prefs: EffectivePreferences,
): boolean {
  if (
    viewer.age === null ||
    viewer.age < prefs.minAge ||
    viewer.age > prefs.maxAge
  ) {
    return false;
  }
  if (
    prefs.genderPref.length > 0 &&
    (!viewer.gender || !prefs.genderPref.includes(viewer.gender))
  ) {
    return false;
  }
  if (
    prefs.relationshipGoalPref.length > 0 &&
    (!viewer.datingIntent ||
      !prefs.relationshipGoalPref.includes(viewer.datingIntent))
  ) {
    return false;
  }
  return true;
}

@Injectable()
export class DeckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: PreferencesService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProviderInterface,
    private readonly presenceService: PresenceService,
  ) {}

  /**
   * FR-36..FR-39: preference-filtered, already-swiped-excluded candidate
   * feed. FR-127/FR-128: a candidate with an active boost the viewer
   * reciprocally satisfies is promoted ahead of everyone else, cursor-paginated
   * via the same `(tier, sortKey, id)` ranked-triple mechanism Feature 9 built.
   */
  async getDeck(
    userId: string,
    query: DeckQueryDto,
  ): Promise<{ candidates: DeckCandidate[]; nextCursor: string | null }> {
    const [prefs, viewer] = await Promise.all([
      this.preferences.getEffective(userId),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          livenessStatus: true,
          birthDate: true,
          gender: true,
          datingIntent: true,
          showLastActiveStatus: true,
        },
      }),
    ]);
    const { earliestBirthDate, latestBirthDate } = ageRangeToBirthDateRange(
      prefs.minAge,
      prefs.maxAge,
    );

    const where: Prisma.UserWhereInput = {
      ...buildSafetyExclusionWhere(userId, viewer.livenessStatus),
      birthDate: { gt: earliestBirthDate, lte: latestBirthDate },
      ...(prefs.verifiedOnly ? { livenessStatus: true } : {}), // FR-47, FR-48
      ...(prefs.genderPref.length ? { gender: { in: prefs.genderPref } } : {}),
      ...(prefs.relationshipGoalPref.length
        ? { datingIntent: { in: prefs.relationshipGoalPref } }
        : {}),
      ...(prefs.activeThisWeekOnly
        ? {
            lastActiveAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          } // FR-49
        : {}),
      // FR-489: one more branch in the same buildSafetyExclusionWhere-based
      // where object — structurally, not just procedurally, inheriting
      // every existing safety exclusion (blocked users, verified-only gate).
      ...(prefs.newMembersOnly
        ? { createdAt: { gte: new Date(Date.now() - NEW_MEMBER_WINDOW_MS) } }
        : {}),
    };

    // The bounded hard-filtered pool, in its base (createdAt, id) order —
    // tiering and pagination both happen against this in-memory pool, not
    // pushed into the DB query (boost tier is a per-candidate reciprocal
    // preference check, not something a single WHERE clause can express
    // across many different candidates' own DiscoveryPreferences rows).
    const pool = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_CANDIDATES_TO_TIER,
      include: { photos: { orderBy: { position: 'asc' } } },
    });

    if (pool.length === 0) {
      return { candidates: [], nextCursor: null };
    }

    // FR-127: which pool candidates currently have an active boost.
    const activeBoosts = await this.prisma.boost.findMany({
      where: {
        userId: { in: pool.map((u) => u.id) },
        endsAt: { gt: new Date() },
      },
      select: { userId: true },
    });

    // FR-127: of those, which ones the viewer reciprocally satisfies —
    // "constrained to the requester's [booster's] own filter," evaluated
    // for real against each boosted candidate's own DiscoveryPreferences.
    const viewerFacts: ViewerFacts = {
      age: viewer.birthDate ? computeAge(viewer.birthDate) : null,
      gender: viewer.gender,
      datingIntent: viewer.datingIntent,
    };
    const reciprocalChecks = await Promise.all(
      activeBoosts.map(async (b) => {
        const boosterPrefs = await this.preferences.getEffective(b.userId);
        return viewerSatisfiesPreferences(viewerFacts, boosterPrefs)
          ? b.userId
          : null;
      }),
    );
    const promotedIds = new Set(reciprocalChecks.filter((id) => id !== null));

    // FR-128: tier 0 (promoted) before tier 1 (everyone else) — a stable
    // sort preserves the existing (createdAt, id) order within each tier.
    const tiered = pool
      .map((u) => ({ user: u, tier: promotedIds.has(u.id) ? 0 : 1 }))
      .sort((a, b) => a.tier - b.tier);

    let startIndex = 0;
    if (query.cursor) {
      const cursor = decodeRankedCursor(query.cursor);
      const cursorTier = cursor.distance ?? 1;
      startIndex = tiered.findIndex(({ user: u, tier }) => {
        if (tier !== cursorTier) return tier > cursorTier;
        if (u.createdAt.getTime() !== cursor.sortKey.getTime()) {
          return u.createdAt.getTime() > cursor.sortKey.getTime();
        }
        return u.id > cursor.id;
      });
      if (startIndex === -1) {
        return { candidates: [], nextCursor: null };
      }
    }

    const page = tiered.slice(startIndex, startIndex + query.limit);

    // FR-486: one batched Redis round trip for the whole page, not one per row.
    const onlineMap = await this.presenceService.getOnlineMap(
      page.map(({ user: u }) => u.id),
    );

    // FR-92: photo URLs generated fresh on every call, same as the profile endpoint.
    const candidates: DeckCandidate[] = await Promise.all(
      page.map(async ({ user: u }) => ({
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
      })),
    );

    const last = page.at(-1);
    const nextCursor =
      last && page.length === query.limit
        ? encodeRankedCursor(last.tier, last.user.createdAt, last.user.id)
        : null;

    return { candidates, nextCursor };
  }
}
