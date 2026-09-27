import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';

/**
 * FR-168/FR-169: two independent rate-limit axes.
 * - Creation is per-user (mirrors Boost's exact BOOST_RATE_LIMIT_PER_DAY
 *   rolling-24h-window pattern, counting DateShareLink rows directly — no
 *   separate counter table needed).
 * - Lookup is per-IP (there's no authenticated user on the public endpoint)
 *   — mirrors OtpRequest's existing per-IP axis (FR-4), via a new
 *   DateShareLinkLookupAttempt counter table.
 */
@Injectable()
export class DateShareRateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  async enforceCreation(userId: string): Promise<void> {
    const limit = this.config.getOrThrow<number>(
      'DATE_SHARE_LINK_RATE_LIMIT_PER_DAY',
    );
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await this.prisma.dateShareLink.count({
      where: { userId, createdAt: { gte: windowStart } },
    });

    if (recentCount >= limit) {
      await this.auditLog.record({
        actorId: userId,
        action: 'DATE_SHARE_LINK_RATE_LIMIT_EXCEEDED',
        metadata: { limit },
      });
      throw new TooManyRequestsException(
        'Too many date-share links created. Please try again later.',
      );
    }
  }

  async enforceLookup(ip: string): Promise<void> {
    const limit = this.config.getOrThrow<number>(
      'DATE_SHARE_LOOKUP_RATE_LIMIT_PER_IP_PER_MINUTE',
    );
    const windowStart = new Date(Date.now() - 60 * 1000);
    const recentCount = await this.prisma.dateShareLinkLookupAttempt.count({
      where: { ip, createdAt: { gte: windowStart } },
    });

    if (recentCount >= limit) {
      // FR-167: the token itself is never logged — only that a lookup was
      // attempted from this IP, same discipline as the counter row itself.
      // No actorId: there is no authenticated user on this public endpoint.
      await this.auditLog.record({
        action: 'DATE_SHARE_LOOKUP_RATE_LIMIT_EXCEEDED',
        metadata: { ip, limit },
      });
      throw new TooManyRequestsException(
        'Too many attempts. Please try again later.',
      );
    }

    await this.prisma.dateShareLinkLookupAttempt.create({ data: { ip } });
  }
}
