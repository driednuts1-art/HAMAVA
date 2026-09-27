import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiSearchMode } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../../common/exceptions/too-many-requests.exception';

const LIMIT_CONFIG_KEY: Record<AiSearchMode, string> = {
  TEXT: 'AI_SEARCH_TEXT_RATE_LIMIT_PER_MINUTE',
  VOICE: 'AI_SEARCH_VOICE_RATE_LIMIT_PER_MINUTE',
};

/**
 * FR-115: independent per-mode rate limits (text vs. voice — voice
 * materially stricter, Whisper billed separately). Same rolling-window
 * DB-count pattern as `SwipeService.enforceRateLimit` (FR-50), extracted
 * into its own service since three call sites (extract, transcribe, and the
 * final ai-search call — all real, billed vendor calls) share it, not just one.
 */
@Injectable()
export class AiSearchRateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  async enforce(userId: string, mode: AiSearchMode): Promise<void> {
    const limit = this.config.getOrThrow<number>(LIMIT_CONFIG_KEY[mode]);
    const windowStart = new Date(Date.now() - 60 * 1000);
    const recentCount = await this.prisma.aiSearchRequest.count({
      where: { userId, mode, createdAt: { gte: windowStart } },
    });

    if (recentCount >= limit) {
      await this.auditLog.record({
        actorId: userId,
        action: 'AI_SEARCH_RATE_LIMIT_EXCEEDED',
        metadata: { mode, limit },
      });
      throw new TooManyRequestsException(
        'Too many AI search requests. Please slow down.',
      );
    }

    // Records the request for both future rate-limit windows and as a
    // lightweight usage/cost trail — mirrors Swipe's dual role.
    await this.prisma.aiSearchRequest.create({ data: { userId, mode } });
  }
}
