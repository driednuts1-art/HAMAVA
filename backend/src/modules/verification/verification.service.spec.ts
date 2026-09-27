import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { LivenessSessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import { VerificationService } from './verification.service';
import type { LivenessProviderInterface } from './liveness/liveness-provider.interface';

const CONFIG: Record<string, string | number> = {
  PRIVACY_POLICY_VERSION: 'v1',
  LIVENESS_SESSION_LIMIT_PER_HOUR: 5,
};

describe('VerificationService', () => {
  let service: VerificationService;
  let prisma: {
    consentRecord: Record<string, jest.Mock>;
    livenessSession: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
  };
  let provider: {
    startSession: jest.Mock<
      ReturnType<LivenessProviderInterface['startSession']>,
      Parameters<LivenessProviderInterface['startSession']>
    >;
  };
  let auditLog: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      consentRecord: { findFirst: jest.fn(), create: jest.fn() },
      livenessSession: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      user: { update: jest.fn(), findUniqueOrThrow: jest.fn() },
    };
    provider = { startSession: jest.fn() };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new VerificationService(
      prisma as unknown as PrismaService,
      config,
      auditLog as unknown as AuditLogService,
      provider,
    );
  });

  describe('acceptConsent', () => {
    it('records the consent and audit-logs it (FR-11, FR-12)', async () => {
      prisma.consentRecord.create.mockResolvedValue({ id: 'consent-1' });

      await service.acceptConsent('user-1', 'v1');

      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'BIOMETRIC_CONSENT_ACCEPTED',
          targetRef: 'consent-1',
        }),
      );
    });
  });

  describe('startLivenessSession', () => {
    it('rejects when there is no consent for the current policy version (FR-11)', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue(null);
      await expect(service.startLivenessSession('user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(provider.startSession).not.toHaveBeenCalled();
    });

    it('rejects when consent is for an outdated policy version (FR-12)', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue({ policyVersion: 'v0' });
      await expect(service.startLivenessSession('user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects once the per-user attempt limit is reached (FR-15)', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue({ policyVersion: 'v1' });
      prisma.livenessSession.count.mockResolvedValue(5);
      await expect(service.startLivenessSession('user-1')).rejects.toThrow(
        TooManyRequestsException,
      );
    });

    it('records a PASS session, updates the user, and audit-logs it (FR-13, FR-14)', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue({ policyVersion: 'v1' });
      provider.startSession.mockResolvedValue({
        providerSessionRef: 'mock-1',
        status: 'pass',
      });
      prisma.livenessSession.create.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        providerSessionRef: 'mock-1',
        status: LivenessSessionStatus.PASS,
      });
      prisma.livenessSession.findFirst.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        providerSessionRef: 'mock-1',
        provider: 'MockLivenessProvider',
      });

      await service.startLivenessSession('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { livenessStatus: true, livenessVerifiedAt: expect.any(Date) },
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'LIVENESS_VERIFICATION_PASSED',
          targetRef: 'session-1',
        }),
      );
    });
  });
});
