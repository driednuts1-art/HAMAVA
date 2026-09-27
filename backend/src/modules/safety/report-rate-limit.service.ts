import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';

/**
 * Real gap found by the 2026-09-18 technical due-diligence audit: unlike
 * every other user-triggered write in this app (OTP requests, messages,
 * calls, AI search, date-share links, conversational-setup turns), report
 * submission had no dedicated rate limiter — only the global, app-wide
 * `ThrottlerModule` default (100 req/min per IP), which does nothing to
 * stop one authenticated user from mass-reporting a specific target to
 * weaponize the moderation queue. Mirrors `CallRateLimitService`'s exact
 * rolling-window pattern — independent of every other rate limit in the app.
 */
@Injectable()
export class ReportRateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  async enforceCreate(reporterId: string): Promise<void> {
    const limit = this.config.getOrThrow<number>('REPORT_RATE_LIMIT_PER_HOUR');
    const windowStart = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.prisma.report.count({
      where: { reporterId, createdAt: { gte: windowStart } },
    });

    if (recentCount >= limit) {
      await this.auditLog.record({
        actorId: reporterId,
        action: 'REPORT_RATE_LIMIT_EXCEEDED',
        metadata: { limit },
      });
      throw new TooManyRequestsException(
        'Too many reports submitted. Please try again later.',
      );
    }
  }
}
