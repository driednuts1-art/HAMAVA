import { Injectable } from '@nestjs/common';
import { MatchSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { computeAge } from '../../common/age.util';
import { MatchExplanationService } from './match-explanation/match-explanation.service';
import { toMatchExplanationFacts } from './match-explanation/to-match-explanation-facts.util';
import {
  PresenceService,
  type PresenceValue,
} from '../presence/presence.service';

export interface MatchSummary {
  matchId: string;
  matchedAt: Date;
  matchSource: MatchSource;
  matchReasons: string[];
  matchMismatches: string[];
  explanationGeneratedAt: Date | null;
  user: {
    id: string;
    displayName: string | null;
    age: number | null;
    verified: boolean;
    primaryPhotoId: string | null;
    /** Feature 27 (FR-485/FR-486): null when either party's showLastActiveStatus is off. */
    presence: PresenceValue | null;
  };
}

@Injectable()
export class MatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matchExplanation: MatchExplanationService,
    private readonly presenceService: PresenceService,
  ) {}

  /** FR-45: the caller's matches, most recent first, with the other user's basic profile. */
  async listMatches(userId: string): Promise<MatchSummary[]> {
    const [matches, viewer] = await Promise.all([
      this.prisma.match.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        orderBy: { createdAt: 'desc' },
        include: {
          userA: {
            include: { photos: { orderBy: { position: 'asc' }, take: 1 } },
          },
          userB: {
            include: { photos: { orderBy: { position: 'asc' }, take: 1 } },
          },
        },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { showLastActiveStatus: true },
      }),
    ]);

    // FR-122: lazily generate + persist reasons/mismatches for any match
    // that doesn't have them yet (SUPER_LIKE matches already got theirs at
    // creation time — FR-125). `explanationGeneratedAt` (not "array is
    // non-empty") is the real gate — an empty `matchReasons`/`matchMismatches`
    // pair is a legitimate generated-but-honest result (FR-304), not "not
    // generated." Sequential, not Promise.all: this is a pull-based list
    // read, not a latency-sensitive hot path like swiping, so there's no
    // need to fan out real vendor concurrency for it.
    for (const m of matches) {
      if (m.explanationGeneratedAt !== null) continue;
      const explanation = await this.matchExplanation.generate(
        toMatchExplanationFacts(m.userA),
        toMatchExplanationFacts(m.userB),
      );
      if (explanation !== null) {
        const explanationGeneratedAt = new Date();
        await this.prisma.match.update({
          where: { id: m.id },
          data: {
            matchReasons: explanation.reasons,
            matchMismatches: explanation.mismatches,
            explanationGeneratedAt,
          },
        });
        m.matchReasons = explanation.reasons;
        m.matchMismatches = explanation.mismatches;
        m.explanationGeneratedAt = explanationGeneratedAt;
      }
    }

    // FR-486: one batched Redis round trip for the whole list.
    const otherIds = matches.map((m) =>
      m.userAId === userId ? m.userBId : m.userAId,
    );
    const onlineMap = await this.presenceService.getOnlineMap(otherIds);

    return matches.map((m) => {
      const other = m.userAId === userId ? m.userB : m.userA;
      return {
        matchId: m.id,
        matchedAt: m.createdAt,
        matchSource: m.source,
        matchReasons: m.matchReasons,
        matchMismatches: m.matchMismatches,
        explanationGeneratedAt: m.explanationGeneratedAt,
        user: {
          id: other.id,
          displayName: other.displayName,
          age: other.birthDate ? computeAge(other.birthDate) : null,
          verified: other.livenessStatus,
          primaryPhotoId: other.photos[0]?.id ?? null,
          presence: this.presenceService.buildPresenceField(
            viewer.showLastActiveStatus,
            other.showLastActiveStatus,
            onlineMap.get(other.id) ?? false,
            other.lastOnlineAt,
          ),
        },
      };
    });
  }
}
