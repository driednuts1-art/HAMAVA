import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';

/** FR-196: independent of MESSAGE_RATE_LIMIT_PER_MINUTE — mirrors FR-57's exact rolling-window pattern. */
@Injectable()
export class CallRateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  async enforceStart(initiatorId: string): Promise<void> {
    const limit = this.config.getOrThrow<number>(
      'CALL_START_RATE_LIMIT_PER_HOUR',
    );
    const windowStart = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.prisma.callSession.count({
      where: { initiatorId, createdAt: { gte: windowStart } },
    });

    if (recentCount >= limit) {
      await this.auditLog.record({
        actorId: initiatorId,
        action: 'CALL_RATE_LIMIT_EXCEEDED',
        metadata: { limit },
      });
      throw new TooManyRequestsException(
        'Too many calls started. Please try again later.',
      );
    }
  }
}
