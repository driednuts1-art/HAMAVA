import {
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModerationContentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import {
  decodeCursor,
  encodeCursor,
} from '../../common/pagination/cursor.util';
import { CONTENT_MODERATION_PROVIDER } from '../../common/moderation/content-moderation-provider.interface';
import type { ContentModerationProviderInterface } from '../../common/moderation/content-moderation-provider.interface';
import { ModerationFlagService } from '../../common/moderation/moderation-flag.service';
import { BlockService } from '../safety/block.service';
import { ConversationAccessService } from './conversation-access.service';
import { ChatGateway } from './chat.gateway';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageHistoryQueryDto } from './dto/message-history-query.dto';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly access: ConversationAccessService,
    private readonly blockService: BlockService,
    private readonly auditLog: AuditLogService,
    private readonly chatGateway: ChatGateway,
    @Inject(CONTENT_MODERATION_PROVIDER)
    private readonly moderation: ContentModerationProviderInterface,
    private readonly moderationFlags: ModerationFlagService,
  ) {}

  /** FR-57: same mechanism as the Feature 3 swipe rate limit, independent config. */
  private async enforceRateLimit(senderId: string): Promise<void> {
    const limit = this.config.getOrThrow<number>(
      'MESSAGE_RATE_LIMIT_PER_MINUTE',
    );
    const windowStart = new Date(Date.now() - 60 * 1000);
    const recentCount = await this.prisma.message.count({
      where: { senderId, sentAt: { gte: windowStart } },
    });

    if (recentCount >= limit) {
      await this.auditLog.record({
        actorId: senderId,
        action: 'MESSAGE_RATE_LIMIT_EXCEEDED',
        metadata: { limit },
      });
      throw new TooManyRequestsException(
        'Too many messages. Please slow down.',
      );
    }
  }

  /**
   * FR-53..FR-58, revised by FR-68..FR-70 (Feature 5): match-gated,
   * idempotent, moderated, rate-limited send. Block enforcement is
   * asymmetric — assertAccessible() below denies the sender outright if
   * *they* blocked the recipient, but a send from the blocked party
   * succeeds and persists exactly like any other message; only the
   * real-time push to the blocker is silently suppressed, further down.
   */
  async sendMessage(matchId: string, senderId: string, dto: SendMessageDto) {
    const match = await this.access.assertAccessible(matchId, senderId);
    const recipientId = this.access.otherParticipant(match, senderId);

    // FR-54: a retry with the same key returns the original message untouched —
    // no re-check of rate-limit/moderation for a request that already succeeded.
    const existing = await this.prisma.message.findUnique({
      where: {
        matchId_senderId_clientIdempotencyKey: {
          matchId,
          senderId,
          clientIdempotencyKey: dto.clientIdempotencyKey,
        },
      },
    });
    if (existing) return existing;

    await this.enforceRateLimit(senderId);

    const moderationResult = await this.moderation.moderateText(dto.content); // FR-56
    if (!moderationResult.approved) {
      await this.auditLog.record({
        actorId: senderId,
        action: 'MESSAGE_TEXT_MODERATION_REJECTED',
        metadata: { matchId, reason: moderationResult.reason },
      });
      // FR-97: retained for human review — a rejected message is otherwise
      // never persisted anywhere.
      await this.moderationFlags.record({
        userId: senderId,
        contentType: ModerationContentType.MESSAGE,
        textContent: dto.content,
        reason: moderationResult.reason,
        contextRef: matchId,
      });
      throw new UnprocessableEntityException(
        moderationResult.reason ?? 'Message did not pass moderation.',
      );
    }

    const message = await this.prisma.message
      .create({
        data: {
          matchId,
          senderId,
          content: dto.content,
          clientIdempotencyKey: dto.clientIdempotencyKey,
        },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          // A concurrent identical retry won the race — return that row, not an error.
          return this.prisma.message.findUniqueOrThrow({
            where: {
              matchId_senderId_clientIdempotencyKey: {
                matchId,
                senderId,
                clientIdempotencyKey: dto.clientIdempotencyKey,
              },
            },
          });
        }
        throw error;
      });

    // FR-70: if the recipient blocked the sender, the send still succeeded
    // and persisted above (identical response either way) — only the push
    // is skipped, silently, so nothing here reveals the block to the sender.
    //
    // docs/roadmap.md: the message above is already durably saved — a real
    // Redis outage must never turn an already-successful send into a
    // failure response. `pushNewMessage()` doesn't itself await anything
    // Redis-dependent (Socket.IO's own room emit queues the underlying
    // publish asynchronously), so this is defensive-in-depth rather than a
    // known failure mode — but with no guard at all, ANY unexpected
    // exception here (synchronous or not) would otherwise propagate out of
    // an already-successful send. FR-58's own "best-effort" comment is the
    // intent; this makes it actually true regardless of the failure shape.
    if (!(await this.blockService.hasBlocked(recipientId, senderId))) {
      try {
        this.chatGateway.pushNewMessage(recipientId, message);
      } catch (error) {
        this.logger.warn(
          `Live push to ${recipientId} failed for message ${message.id} — already persisted, recipient will see it on next fetch: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
    return message;
  }

  /** FR-62: cursor-paginated, newest-first (opposite direction from the Feature 3 deck). */
  async getHistory(
    matchId: string,
    userId: string,
    query: MessageHistoryQueryDto,
  ) {
    await this.access.assertAccessible(matchId, userId);

    const where: Prisma.MessageWhereInput = { matchId };

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      where.OR = [
        { sentAt: { lt: cursor.sortKey } },
        { sentAt: cursor.sortKey, id: { lt: cursor.id } },
      ];
    }

    const messages = await this.prisma.message.findMany({
      where,
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
    });

    const last = messages.at(-1);
    const nextCursor =
      last && messages.length === query.limit
        ? encodeCursor(last.sentAt, last.id)
        : null;

    return { messages, nextCursor };
  }

  /** FR-63: marks every one of the *other* participant's unread messages as read. */
  async markRead(matchId: string, userId: string): Promise<void> {
    const match = await this.access.assertAccessible(matchId, userId);
    const otherId = this.access.otherParticipant(match, userId);

    await this.prisma.message.updateMany({
      where: { matchId, senderId: otherId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
