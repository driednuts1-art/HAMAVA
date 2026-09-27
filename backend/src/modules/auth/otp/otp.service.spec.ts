import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { AuditLogService } from '../../../common/audit-log/audit-log.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TooManyRequestsException } from '../../../common/exceptions/too-many-requests.exception';
import { OtpService } from './otp.service';
import type { OtpProviderInterface } from './otp-provider.interface';

const CONFIG: Record<string, number | string> = {
  OTP_REQUEST_LIMIT_PER_PHONE_PER_HOUR: 5,
  OTP_REQUEST_LIMIT_PER_IP_PER_HOUR: 20,
  OTP_TTL_SECONDS: 300,
  OTP_MAX_ATTEMPTS: 5,
  OTP_RATE_LIMIT_BYPASS: 'false',
};

interface CreateArgs {
  data: { phoneHash: string; ip: string; codeHash: string; expiresAt: Date };
}

function makeCrypto(): CryptoService {
  return new CryptoService({
    getOrThrow: () => 'test-secret',
  } as unknown as ConfigService);
}

describe('OtpService', () => {
  let service: OtpService;
  let prisma: { otpRequest: Record<string, jest.Mock> };
  let provider: {
    sendOtp: jest.Mock<
      ReturnType<OtpProviderInterface['sendOtp']>,
      Parameters<OtpProviderInterface['sendOtp']>
    >;
  };
  let auditLog: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      otpRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    provider = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;
    const crypto = makeCrypto();

    service = new OtpService(
      prisma as unknown as PrismaService,
      crypto,
      config,
      auditLog as unknown as AuditLogService,
      provider,
    );
  });

  describe('requestOtp', () => {
    it('creates a hashed OTP request and delivers it via the provider (FR-2, FR-3, FR-6)', async () => {
      await service.requestOtp('+989121234567', '127.0.0.1');

      expect(prisma.otpRequest.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.otpRequest.create.mock
        .calls[0][0] as CreateArgs;
      expect(createArgs.data.codeHash).not.toMatch(/^\d{6}$/); // never store the plaintext code
      expect(provider.sendOtp).toHaveBeenCalledTimes(1);
      const [sentPhone, sentCode] = provider.sendOtp.mock.calls[0];
      expect(sentPhone).toBe('+989121234567');
      expect(sentCode).toMatch(/^\d{6}$/);
    });

    it('rejects once the per-phone limit is reached (FR-4)', async () => {
      prisma.otpRequest.count.mockResolvedValueOnce(5); // per-phone count
      await expect(
        service.requestOtp('+989121234567', '127.0.0.1'),
      ).rejects.toThrow(TooManyRequestsException);
      expect(provider.sendOtp).not.toHaveBeenCalled();
    });

    it('rejects once the per-IP limit is reached (FR-4)', async () => {
      prisma.otpRequest.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(20); // per-IP count
      await expect(
        service.requestOtp('+989121234567', '127.0.0.1'),
      ).rejects.toThrow(TooManyRequestsException);
    });

    it('skips the limit check entirely when OTP_RATE_LIMIT_BYPASS is enabled (test-only escape hatch)', async () => {
      CONFIG.OTP_RATE_LIMIT_BYPASS = 'true';
      try {
        prisma.otpRequest.count.mockResolvedValue(999); // would fail both limits if checked
        await service.requestOtp('+989121234567', '127.0.0.1');

        expect(prisma.otpRequest.count).not.toHaveBeenCalled();
        expect(prisma.otpRequest.create).toHaveBeenCalledTimes(1);
        expect(provider.sendOtp).toHaveBeenCalledTimes(1);
      } finally {
        CONFIG.OTP_RATE_LIMIT_BYPASS = 'false'; // don't leak into other tests
      }
    });
  });

  describe('verifyOtp', () => {
    it('rejects and audit-logs when there is no pending OTP for the phone', async () => {
      prisma.otpRequest.findFirst.mockResolvedValue(null);
      await expect(
        service.verifyOtp('+989121234567', '123456'),
      ).rejects.toThrow(UnauthorizedException);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'OTP_VERIFY_FAILED' }),
      );
    });

    it('increments attemptCount, audit-logs, and rejects on a wrong code (FR-5)', async () => {
      const crypto = makeCrypto();
      const codeHash = await crypto.hashOtpCode('999999');
      prisma.otpRequest.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash,
        attemptCount: 0,
      });

      await expect(
        service.verifyOtp('+989121234567', '000000'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.otpRequest.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { attemptCount: { increment: 1 } },
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'OTP_VERIFY_FAILED',
          targetRef: 'otp-1',
        }),
      );
    });

    it('rejects once attemptCount reaches the configured max (FR-5)', async () => {
      prisma.otpRequest.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: 'anything',
        attemptCount: 5,
      });
      await expect(
        service.verifyOtp('+989121234567', '123456'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('marks the OTP consumed and returns the phone hash on a correct code', async () => {
      const crypto = makeCrypto();
      const phoneHash = crypto.hashPhone('+989121234567');
      const codeHash = await crypto.hashOtpCode('123456');

      prisma.otpRequest.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash,
        attemptCount: 0,
      });

      const result = await service.verifyOtp('+989121234567', '123456');

      expect(result).toBe(phoneHash);
      expect(prisma.otpRequest.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { consumedAt: expect.any(Date) },
      });
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });
});
