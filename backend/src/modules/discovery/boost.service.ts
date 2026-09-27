import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';

export interface BoostStatus {
  active: boolean;
  endsAt: Date | null;
}

@Injectable()
export class BoostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** FR-130: activation-count rate limit, same rolling-window pattern as FR-50/FR-115. */
  private async enforceRateLimit(userId: string): Promise<void> {
    const limit = this.config.getOrThrow<number>('BOOST_RATE_LIMIT_PER_DAY');
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await this.prisma.boost.count({
      where: { userId, createdAt: { gte: windowStart } },
    });

    if (recentCount >= limit) {
      await this.auditLog.record({
        actorId: userId,
        action: 'BOOST_RATE_LIMIT_EXCEEDED',
        metadata: { limit },
      });
      throw new TooManyRequestsException(
        'Too many boost activations. Please try again later.',
      );
    }
  }

  /** FR-126: rejects (409) if the caller already has an active boost — not stackable. */
  async activate(userId: string): Promise<BoostStatus> {
    const current = await this.getStatus(userId);
    if (current.active) {
      throw new ConflictException('A boost is already active.');
    }

    await this.enforceRateLimit(userId);

    const durationMinutes = this.config.getOrThrow<number>(
      'BOOST_DURATION_MINUTES',
    );
    const boost = await this.prisma.boost.create({
      data: { userId, endsAt: new Date(Date.now() + durationMinutes * 60_000) },
    });
    return { active: true, endsAt: boost.endsAt };
  }

  /** FR-127: "currently active" is evaluated as endsAt > now at read time, not a stored flag. */
  async getStatus(userId: string): Promise<BoostStatus> {
    const active = await this.prisma.boost.findFirst({
      where: { userId, endsAt: { gt: new Date() } },
      orderBy: { endsAt: 'desc' },
    });
    return { active: active !== null, endsAt: active?.endsAt ?? null };
  }
}
