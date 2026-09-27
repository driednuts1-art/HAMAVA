import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LivenessSessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import { LIVENESS_PROVIDER } from './liveness/liveness-provider.interface';
import type {
  LivenessProviderInterface,
  LivenessResultStatus,
} from './liveness/liveness-provider.interface';

const STATUS_MAP: Record<LivenessResultStatus, LivenessSessionStatus> = {
  pending: LivenessSessionStatus.PENDING,
  pass: LivenessSessionStatus.PASS,
  fail: LivenessSessionStatus.FAIL,
};

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
    @Inject(LIVENESS_PROVIDER)
    private readonly livenessProvider: LivenessProviderInterface,
  ) {}

  /** FR-11, FR-12: record biometric consent, versioned against the current policy. */
  async acceptConsent(userId: string, policyVersion: string) {
    const record = await this.prisma.consentRecord.create({
      data: { userId, policyVersion },
    });
    await this.auditLog.record({
      actorId: userId,
      action: 'BIOMETRIC_CONSENT_ACCEPTED',
      targetRef: record.id,
      metadata: { policyVersion },
    });
    return record;
  }

  private async requireCurrentConsent(userId: string): Promise<void> {
    const currentVersion = this.config.getOrThrow<string>(
      'PRIVACY_POLICY_VERSION',
    );
    const latestConsent = await this.prisma.consentRecord.findFirst({
      where: { userId },
      orderBy: { acceptedAt: 'desc' },
    });

    if (!latestConsent || latestConsent.policyVersion !== currentVersion) {
      throw new ForbiddenException(
        'Biometric consent for the current privacy policy version is required before liveness verification.',
      );
    }
  }

  /** FR-13..FR-15: start a liveness challenge via the provider abstraction. */
  async startLivenessSession(userId: string) {
    await this.requireCurrentConsent(userId);

    const windowStart = new Date(Date.now() - 60 * 60 * 1000);
    const recentAttempts = await this.prisma.livenessSession.count({
      where: { userId, createdAt: { gte: windowStart } },
    });
    const limit = this.config.getOrThrow<number>(
      'LIVENESS_SESSION_LIMIT_PER_HOUR',
    );
    if (recentAttempts >= limit) {
      throw new TooManyRequestsException(
        'Too many liveness attempts. Please try again later.',
      );
    }

    const result = await this.livenessProvider.startSession(userId);

    const session = await this.prisma.livenessSession.create({
      data: {
        userId,
        provider: this.livenessProvider.constructor.name,
        providerSessionRef: result.providerSessionRef,
        status: STATUS_MAP[result.status],
        resolvedAt: result.status === 'pending' ? null : new Date(),
      },
    });

    if (result.status !== 'pending') {
      await this.applyResult(session.providerSessionRef!, result.status);
    }

    return session;
  }

  /** FR-14: apply a (possibly async, future real-vendor) pass/fail result. No capture data involved. */
  async applyResult(providerSessionRef: string, result: 'pass' | 'fail') {
    const session = await this.prisma.livenessSession.findFirst({
      where: { providerSessionRef },
    });
    if (!session) {
      throw new NotFoundException('Unknown liveness session reference.');
    }

    const status = STATUS_MAP[result];
    await this.prisma.livenessSession.update({
      where: { id: session.id },
      data: { status, resolvedAt: new Date() },
    });

    if (result === 'pass') {
      await this.prisma.user.update({
        where: { id: session.userId },
        data: { livenessStatus: true, livenessVerifiedAt: new Date() },
      });
    }

    await this.auditLog.record({
      actorId: session.userId,
      action:
        result === 'pass'
          ? 'LIVENESS_VERIFICATION_PASSED'
          : 'LIVENESS_VERIFICATION_FAILED',
      targetRef: session.id,
      metadata: { provider: session.provider, providerSessionRef },
    });

    return session;
  }

  async getStatus(userId: string) {
    const [user, latestSession] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.livenessSession.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      livenessStatus: user.livenessStatus,
      livenessVerifiedAt: user.livenessVerifiedAt,
      latestSessionStatus: latestSession?.status ?? null,
    };
  }
}
