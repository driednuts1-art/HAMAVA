import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingPermission, Prisma, SwipeAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import { MatchExplanationService } from './match-explanation/match-explanation.service';
import type { GeneratedExplanation } from './match-explanation/match-explanation-provider.interface';
import { toMatchExplanationFacts } from './match-explanation/to-match-explanation-facts.util';

export interface SwipeResult {
  swipeId: string;
  action: SwipeAction;
  matched: boolean;
  matchId?: string;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

const LIKE_ACTIONS: SwipeAction[] = [SwipeAction.LIKE, SwipeAction.SUPER_LIKE];

@Injectable()
export class SwipeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
    private readonly matchExplanation: MatchExplanationService,
  ) {}

  /** FR-50: swipe-specific rate limit — the "swipe velocity anomaly" risk signal from product.md §5. */
  private async enforceRateLimit(actorId: string): Promise<void> {
    const limit = this.config.getOrThrow<number>('SWIPE_RATE_LIMIT_PER_MINUTE');
    const windowStart = new Date(Date.now() - 60 * 1000);
    const recentCount = await this.prisma.swipe.count({
      where: { actorId, createdAt: { gte: windowStart } },
    });

    if (recentCount >= limit) {
      await this.auditLog.record({
        actorId,
        action: 'SWIPE_RATE_LIMIT_EXCEEDED',
        metadata: { limit },
      });
      throw new TooManyRequestsException('Too many swipes. Please slow down.');
    }
  }

  /** FR-40..FR-44: record a swipe, and atomically create a Match on a mutual like. */
  async recordSwipe(
    actorId: string,
    targetId: string,
    action: SwipeAction,
  ): Promise<SwipeResult> {
    if (actorId === targetId) {
      throw new BadRequestException('Cannot swipe on yourself.');
    }

    await this.enforceRateLimit(actorId);

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
    });
    if (!target) {
      throw new NotFoundException('Candidate not found.');
    }

    // FR-124: generated BEFORE the transaction, not inside it — an external
    // vendor call (seconds, unpredictable) must never hold open a Neon
    // interactive transaction (docs/architecture.md §5.1's cold-start
    // budget is tuned for DB work only). Fails open (MatchExplanationService
    // returns null on any failure) — a Super Like always succeeds either way.
    let explanation: GeneratedExplanation | null = null;
    if (action === SwipeAction.SUPER_LIKE) {
      const actorProfile = await this.prisma.user.findUniqueOrThrow({
        where: { id: actorId },
      });
      explanation = await this.matchExplanation.generate(
        toMatchExplanationFacts(actorProfile),
        toMatchExplanationFacts(target),
      );
    }

    // A P2028 (transaction manager error, e.g. Neon cold-start — see
    // docs/architecture.md §5.1) can still surface from this call if 10s
    // wasn't enough; that's handled globally by ProblemDetailsFilter (503,
    // requirements.md FR-52), not here — no per-call-site handling needed.
    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const swipe = await tx.swipe
          .create({
            data: {
              actorId,
              targetId,
              action,
              explanationReasons: explanation?.reasons ?? [],
              explanationMismatches: explanation?.mismatches ?? [],
            },
          })
          .catch((error: unknown) => {
            if (isUniqueViolation(error)) {
              throw new ConflictException(
                'You have already swiped on this candidate.',
              ); // FR-40
            }
            throw error;
          });

        if (!LIKE_ACTIONS.includes(action)) {
          return { swipeId: swipe.id, action, matched: false };
        }

        const reciprocal = await tx.swipe.findUnique({
          where: { actorId_targetId: { actorId: targetId, targetId: actorId } },
        });

        if (!reciprocal || !LIKE_ACTIONS.includes(reciprocal.action)) {
          return { swipeId: swipe.id, action, matched: false };
        }

        // FR-67 (Feature 5) defense-in-depth: DeckService already excludes
        // blocked pairs from ever being shown, so this should be unreachable
        // in practice — but a match must never be created between a blocked
        // pair even if a stale client re-submits swipes for both, so it's
        // checked again here, atomically, inside the same transaction.
        const blocked = await tx.block.findFirst({
          where: {
            OR: [
              { blockerId: actorId, blockedId: targetId },
              { blockerId: targetId, blockedId: actorId },
            ],
          },
          select: { id: true },
        });
        if (blocked) {
          return { swipeId: swipe.id, action, matched: false };
        }

        // FR-79 (Feature 6) defense-in-depth: DeckService already excludes a
        // VERIFIED_ONLY candidate from an unverified viewer's deck, so this
        // should be unreachable in practice — checked again here for the
        // same reason as the block guard above: a stale client must never
        // be able to force a match neither side's setting actually allows.
        const actor = await tx.user.findUniqueOrThrow({
          where: { id: actorId },
          select: { livenessStatus: true, messagingPermission: true },
        });
        const violatesMessagingPermission =
          (target.messagingPermission === MessagingPermission.VERIFIED_ONLY &&
            !actor.livenessStatus) ||
          (actor.messagingPermission === MessagingPermission.VERIFIED_ONLY &&
            !target.livenessStatus);
        if (violatesMessagingPermission) {
          return { swipeId: swipe.id, action, matched: false };
        }

        // FR-42: canonical ordering so a mutual like can never produce two rows for the same pair.
        const [userAId, userBId] = [actorId, targetId].sort();
        const source =
          action === SwipeAction.SUPER_LIKE ? 'SUPER_LIKE' : 'SWIPE'; // FR-43

        // FR-125: a Super Like's own explanation becomes the match's
        // reasons/mismatches directly — no second generation call. A regular
        // match starts with both arrays empty and explanationGeneratedAt
        // null, lazily filled in on first read (MatchService, FR-122).
        // explanationGeneratedAt is set only when generation genuinely
        // succeeded (`explanation !== null`) — a fail-open null must still
        // be eligible for MatchService's own lazy retry on next read, same
        // as the pre-Feature-21 `whyYouTwo !== null` gate already did.
        const isSuperLike = source === 'SUPER_LIKE';
        const match = await tx.match
          .create({
            data: {
              userAId,
              userBId,
              source,
              matchReasons: isSuperLike ? (explanation?.reasons ?? []) : [],
              matchMismatches: isSuperLike
                ? (explanation?.mismatches ?? [])
                : [],
              explanationGeneratedAt:
                isSuperLike && explanation !== null ? new Date() : null,
            },
          })
          .catch(async (error: unknown) => {
            if (isUniqueViolation(error)) {
              // FR-41: a concurrent mutual like already created this match — report it, don't duplicate.
              return tx.match.findUniqueOrThrow({
                where: { userAId_userBId: { userAId, userBId } },
              });
            }
            throw error;
          });

        return { swipeId: swipe.id, action, matched: true, matchId: match.id };
      },
      // Neon's serverless compute can cold-start (suspended after idle); Prisma's
      // defaults (maxWait/timeout ~2-5s) are too tight for that — give the
      // transaction room to actually acquire a connection and complete.
      { maxWait: 10_000, timeout: 10_000 },
    );
  }
}
