import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { computeAge, ageRangeToBirthDateRange } from '../../../common/age.util';
import { buildSafetyExclusionWhere } from '../candidate-exclusion.util';
import { buildCandidateProfileFields } from '../candidate-profile-fields.util';
import { PreferencesService } from '../preferences.service';
import { isNewMember, type DeckCandidate } from '../deck.service';
import { PresenceService } from '../../presence/presence.service';
import {
  decodeRankedCursor,
  encodeRankedCursor,
} from '../../../common/pagination/cursor.util';
import { EMBEDDING_PROVIDER } from '../../../common/ai/embedding-provider.interface';
import type { EmbeddingProviderInterface } from '../../../common/ai/embedding-provider.interface';
import { STORAGE_PROVIDER } from '../../profile/storage/storage-provider.interface';
import type { StorageProviderInterface } from '../../profile/storage/storage-provider.interface';
import { AiSearchDto } from './dto/ai-search.dto';
import { AiSearchRateLimitService } from './ai-search-rate-limit.service';
import { withDeckFallbackHint } from './vendor-failure.util';
import { computeMatchScoreFromDistance } from '../matching/match-score.types';

// FR-111: pragmatic cap on the hard-filtered candidate pool passed into the
// ranking query — a known-access-pattern tuning choice (same instinct as
// Feature 3's indexing note), not a product requirement. Large enough that
// no realistic query hits it during this feature's actual usage patterns;
// revisit with real query-plan data if the candidate pool ever approaches it.
const MAX_CANDIDATES_TO_RANK = 2000;

interface RankedRow {
  id: string;
  distance: number | null;
  createdAt: Date;
}

@Injectable()
export class AiSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: PreferencesService,
    private readonly rateLimit: AiSearchRateLimitService,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProviderInterface,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProviderInterface,
    private readonly presenceService: PresenceService,
  ) {}

  /** FR-109..FR-114: hard filter, then semantic ranking, cursor-paginated. */
  async search(
    userId: string,
    dto: AiSearchDto,
  ): Promise<{ candidates: DeckCandidate[]; nextCursor: string | null }> {
    await this.rateLimit.enforce(userId, dto.mode);

    const [prefs, viewer] = await Promise.all([
      this.preferences.getEffective(userId),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { livenessStatus: true, showLastActiveStatus: true },
      }),
    ]);

    // FR-109: the exact same safety exclusions DeckService applies.
    const where: Prisma.UserWhereInput = {
      ...buildSafetyExclusionWhere(userId, viewer.livenessStatus),
      // FR-110: verifiedOnly ALWAYS comes from the caller's own standing
      // preference — AiSearchDto has no such field, so there is nothing in
      // the request body that could express turning this off.
      ...(prefs.verifiedOnly ? { livenessStatus: true } : {}),
    };

    if (dto.city) {
      where.city = { contains: dto.city, mode: 'insensitive' };
    }
    if (dto.minAge !== undefined || dto.maxAge !== undefined) {
      const { earliestBirthDate, latestBirthDate } = ageRangeToBirthDateRange(
        dto.minAge ?? 18,
        dto.maxAge ?? 100,
      );
      where.birthDate = { gt: earliestBirthDate, lte: latestBirthDate };
    }
    if (dto.gender?.length) {
      where.gender = { in: dto.gender };
    }
    if (dto.relationshipGoal?.length) {
      where.datingIntent = { in: dto.relationshipGoal };
    }

    // Step 1: the filtered candidate pool, via Prisma's normal type-safe
    // query builder — every relational/safety condition above stays outside
    // raw SQL entirely, keeping this feature's one raw query (step 2) as
    // small and low-risk as it can be.
    const filtered = await this.prisma.user.findMany({
      where,
      select: { id: true },
      take: MAX_CANDIDATES_TO_RANK,
    });

    if (filtered.length === 0) {
      return { candidates: [], nextCursor: null }; // FR-114: honest empty result.
    }
    const ids = filtered.map((u) => u.id);

    // FR-111: the query embedding — the only thing computed at search time;
    // candidate embeddings are precomputed (FR-112).
    const queryEmbedding = await withDeckFallbackHint(() =>
      this.embeddingProvider.embed(dto.semanticQuery),
    );
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    const cursor = dto.cursor ? decodeRankedCursor(dto.cursor) : null;
    // NULLS-LAST trick: treat a NULL distance (no embedding yet, FR-112) as
    // +Infinity so ORDER BY / the keyset comparison both stay simple,
    // consistent 3-tuple comparisons — no separate NULLS LAST clause needed.
    //
    // Feature 21 regression check, real bug found and fixed (pre-existing,
    // not introduced here — this exact code path had never been exercised
    // by any prior e2e run, since it needs more un-embedded candidates than
    // fit on one page before a second page ever crosses the Infinity-tier
    // boundary; confirmed directly: `SELECT ${Infinity}::float8` returns SQL
    // NULL, not the float8 Infinity value — passing JS `Infinity` as a
    // normal Prisma.sql parameter silently loses it). Any SQL comparison
    // against NULL evaluates to NULL (never true), so the cursor's WHERE
    // clause matched nothing at all once `cursor.distance` was Infinity,
    // making every un-embedded candidate past the first page permanently
    // unreachable. Fixed by using the real 'Infinity'::float8 SQL literal
    // (a constant, never user input — safe as Prisma.raw) instead of
    // binding Infinity as a normal parameter, for this one value only.
    const cursorDistanceSql =
      cursor !== null &&
      cursor.distance !== null &&
      Number.isFinite(cursor.distance)
        ? Prisma.sql`${cursor.distance}::float8`
        : Prisma.raw(`'Infinity'::float8`);
    const cursorClause = cursor
      ? Prisma.sql`WHERE (distance, "createdAt", id) > (${cursorDistanceSql}, ${cursor.sortKey}, ${cursor.id})`
      : Prisma.empty;

    const ranked = await this.prisma.$queryRaw<RankedRow[]>(Prisma.sql`
      WITH ranked AS (
        SELECT id, "createdAt",
          COALESCE("bioEmbedding" <=> ${vectorLiteral}::vector, 'Infinity'::float8) AS distance
        FROM users
        WHERE id = ANY(${ids}::text[])
      )
      SELECT id, distance, "createdAt"
      FROM ranked
      ${cursorClause}
      ORDER BY distance ASC, "createdAt" ASC, id ASC
      LIMIT ${dto.limit}
    `);

    if (ranked.length === 0) {
      return { candidates: [], nextCursor: null };
    }

    // Step 3: fetch full rows for just this page, then restore the ranked
    // order — `findMany({ where: { id: { in: [...] } } })` does not
    // preserve list order.
    const rankedIds = ranked.map((r) => r.id);
    const users = await this.prisma.user.findMany({
      where: { id: { in: rankedIds } },
      include: { photos: { orderBy: { position: 'asc' } } },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    // FR-486: one batched Redis round trip for the whole page.
    const onlineMap = await this.presenceService.getOnlineMap(rankedIds);

    const candidates: DeckCandidate[] = await Promise.all(
      ranked.map(async (r): Promise<DeckCandidate | null> => {
        const u = byId.get(r.id);
        if (!u) {
          // Defensive only: a candidate could theoretically be deleted
          // between step 2 and step 3 under real concurrent writes.
          return null;
        }
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
          // FR-291/FR-292 (Feature 21): a null distance (no embedding yet,
          // same NULLS-LAST convention as everywhere else in this query)
          // maps to Infinity — least similar, not "arithmetic null coerced
          // to 0," which would wrongly read as maximally similar.
          matchScore: computeMatchScoreFromDistance(r.distance ?? Infinity),
        };
      }),
    ).then((rows) => rows.filter((c): c is DeckCandidate => c !== null));

    const last = ranked.at(-1);
    const nextCursor =
      last && ranked.length === dto.limit
        ? encodeRankedCursor(last.distance, last.createdAt, last.id)
        : null;

    return { candidates, nextCursor };
  }
}
