import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MatchFeedbackRating, MatchFeedbackReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface MatchFeedbackSummary {
  rating: MatchFeedbackRating;
  reasonCode: MatchFeedbackReason | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * FR-293..FR-295 (Feature 21): explicit, optional match-relevance feedback —
 * instrumentation only (the master directive's own "first instrument,
 * don't train a model yet" instruction), never required by any other flow,
 * never used as a ranking input by this feature.
 */
@Injectable()
export class MatchFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  /** FR-293: 404 if the match doesn't exist, 403 if it exists but isn't the caller's — the same posture Feature 12 established for a durable, mutually-known resource. */
  private async assertParticipant(
    userId: string,
    matchId: string,
  ): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
    });
    if (!match) throw new NotFoundException('Match not found.');
    if (match.userAId !== userId && match.userBId !== userId) {
      throw new ForbiddenException('Not a participant of this match.');
    }
  }

  /** FR-293: upsert — leaving feedback twice updates it, never a duplicate-row error. */
  async submit(
    userId: string,
    matchId: string,
    rating: MatchFeedbackRating,
    reasonCode: MatchFeedbackReason | undefined,
  ): Promise<MatchFeedbackSummary> {
    await this.assertParticipant(userId, matchId);
    return this.prisma.matchFeedback.upsert({
      where: { matchId_userId: { matchId, userId } },
      create: { matchId, userId, rating, reasonCode },
      update: { rating, reasonCode: reasonCode ?? null },
      select: {
        rating: true,
        reasonCode: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /** FR-295: the caller's own feedback only — never the other participant's. */
  async getMine(
    userId: string,
    matchId: string,
  ): Promise<MatchFeedbackSummary | null> {
    await this.assertParticipant(userId, matchId);
    return this.prisma.matchFeedback.findUnique({
      where: { matchId_userId: { matchId, userId } },
      select: {
        rating: true,
        reasonCode: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
