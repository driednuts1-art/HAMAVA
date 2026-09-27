import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationalSetupRequestKind } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../../common/exceptions/too-many-requests.exception';

const LIMIT_CONFIG_KEY: Record<ConversationalSetupRequestKind, string> = {
  SESSION_START: 'CONVERSATIONAL_SETUP_SESSION_START_RATE_LIMIT_PER_HOUR',
  TEXT_TURN: 'CONVERSATIONAL_SETUP_TEXT_TURN_RATE_LIMIT_PER_MINUTE',
  VOICE_TURN: 'CONVERSATIONAL_SETUP_VOICE_TURN_RATE_LIMIT_PER_MINUTE',
};

const WINDOW_MS: Record<ConversationalSetupRequestKind, number> = {
  SESSION_START: 60 * 60 * 1000,
  TEXT_TURN: 60 * 1000,
  VOICE_TURN: 60 * 1000,
};

/**
 * FR-148: independent rolling-window limits for session starts and each
 * turn type — mirrors `AiSearchRateLimitService`'s exact pattern (a
 * `ConversationalSetupRequest` row is never conversation content, FR-143 —
 * just a rolling-window counter, like `AiSearchRequest`/`Swipe`).
 */
@Injectable()
export class ConversationalSetupRateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  async enforce(
    userId: string,
    kind: ConversationalSetupRequestKind,
  ): Promise<void> {
    const limit = this.config.getOrThrow<number>(LIMIT_CONFIG_KEY[kind]);
    const windowStart = new Date(Date.now() - WINDOW_MS[kind]);
    const recentCount = await this.prisma.conversationalSetupRequest.count({
      where: { userId, kind, createdAt: { gte: windowStart } },
    });

    if (recentCount >= limit) {
      await this.auditLog.record({
        actorId: userId,
        action: 'CONVERSATIONAL_SETUP_RATE_LIMIT_EXCEEDED',
        metadata: { kind, limit },
      });
      throw new TooManyRequestsException(
        'Too many conversational-setup requests. Please slow down.',
      );
    }

    await this.prisma.conversationalSetupRequest.create({
      data: { userId, kind },
    });
  }
}
