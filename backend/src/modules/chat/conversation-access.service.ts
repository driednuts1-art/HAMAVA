import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Match } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BlockService } from '../safety/block.service';

/** FR-53: shared match-gating for every chat operation. */
@Injectable()
export class ConversationAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blockService: BlockService,
  ) {}

  async assertParticipant(matchId: string, userId: string): Promise<Match> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
    });
    if (!match) {
      throw new NotFoundException('Conversation not found.');
    }
    if (match.userAId !== userId && match.userBId !== userId) {
      throw new ForbiddenException('Not a participant in this conversation.');
    }
    return match;
  }

  /**
   * FR-68: layered on top of assertParticipant() for read/send-style
   * operations (history, send, mark-read) — treats the match as if it
   * doesn't exist when the *caller* has blocked the other participant.
   * Deliberately NOT used for block/report themselves (FR-68's own text):
   * those stay reachable regardless, matching FR-65's "always reachable"
   * report principle. Also deliberately one-directional — if the *other*
   * participant blocked the caller, this returns normally (FR-69):
   * the blocked party's access must show no sign of the block.
   */
  async assertAccessible(matchId: string, userId: string): Promise<Match> {
    const match = await this.assertParticipant(matchId, userId);
    const otherId = this.otherParticipant(match, userId);
    if (await this.blockService.hasBlocked(userId, otherId)) {
      throw new NotFoundException('Conversation not found.');
    }
    return match;
  }

  otherParticipant(
    match: Pick<Match, 'userAId' | 'userBId'>,
    userId: string,
  ): string {
    return match.userAId === userId ? match.userBId : match.userAId;
  }
}
