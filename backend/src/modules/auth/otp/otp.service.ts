import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { AuditLogService } from '../../../common/audit-log/audit-log.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TooManyRequestsException } from '../../../common/exceptions/too-many-requests.exception';
import { isMockProvider } from '../../../common/production-safety/mock-provider.marker';
import { OTP_PROVIDER } from './otp-provider.interface';
import type { OtpProviderInterface } from './otp-provider.interface';

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProviderInterface,
  ) {}

  /**
   * FR-2..FR-4, FR-6: generate, rate-limit, persist (hashed), and deliver an
   * OTP. Returns the real code only when Feature 14's `AUTH_OTP_DEBUG_ECHO`
   * flag is on *and* the wired `OTP_PROVIDER` is genuinely the mock
   * (`isMockProvider`, the same marker `ProductionSafetyService` already
   * uses) — a real SMS vendor never has its delivered code echoed back,
   * regardless of the flag. Exists solely so a separate Playwright process
   * (frontend/e2e, docs/requirements.md Feature 14 FR-223) can complete a
   * real login flow without log-scraping; refused at boot in production
   * (ProductionSafetyService), same shape as OTP_RATE_LIMIT_BYPASS.
   */
  async requestOtp(
    phoneE164: string,
    ip: string,
  ): Promise<{ devCode?: string }> {
    const phoneHash = this.crypto.hashPhone(phoneE164);

    // Test-only escape hatch (docs/roadmap.md): the full e2e suite creates
    // many users per file, all sharing the loopback IP, and OtpRequest rows
    // persist across files within one run — cumulative per-IP requests can
    // spuriously hit the real limit. Never true outside e2e runs (test/jest-e2e.setup.ts
    // is the only place that sets it, and ProductionSafetyService refuses to
    // boot with it enabled in production) — FR-4's 429 behavior stays
    // covered by otp.service.spec.ts, which never sets this flag.
    const bypassRateLimit =
      this.config.getOrThrow<string>('OTP_RATE_LIMIT_BYPASS') === 'true';

    if (!bypassRateLimit) {
      const windowStart = new Date(Date.now() - 60 * 60 * 1000);

      const [perPhoneCount, perIpCount] = await Promise.all([
        this.prisma.otpRequest.count({
          where: { phoneHash, createdAt: { gte: windowStart } },
        }),
        this.prisma.otpRequest.count({
          where: { ip, createdAt: { gte: windowStart } },
        }),
      ]);

      const phoneLimit = this.config.getOrThrow<number>(
        'OTP_REQUEST_LIMIT_PER_PHONE_PER_HOUR',
      );
      const ipLimit = this.config.getOrThrow<number>(
        'OTP_REQUEST_LIMIT_PER_IP_PER_HOUR',
      );

      if (perPhoneCount >= phoneLimit || perIpCount >= ipLimit) {
        throw new TooManyRequestsException(
          'Too many OTP requests. Please try again later.',
        );
      }
    }

    const code = this.crypto.generateOtpCode();
    const codeHash = await this.crypto.hashOtpCode(code);
    const ttlSeconds = this.config.getOrThrow<number>('OTP_TTL_SECONDS');

    await this.prisma.otpRequest.create({
      data: {
        phoneHash,
        ip,
        codeHash,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
    });

    await this.otpProvider.sendOtp(phoneE164, code);

    const debugEchoEnabled =
      this.config.getOrThrow<string>('AUTH_OTP_DEBUG_ECHO') === 'true';
    if (debugEchoEnabled && isMockProvider(this.otpProvider)) {
      return { devCode: code };
    }
    return {};
  }

  /** FR-3, FR-5: verify a code against the latest pending request for this phone. */
  async verifyOtp(phoneE164: string, code: string): Promise<string> {
    const phoneHash = this.crypto.hashPhone(phoneE164);
    const maxAttempts = this.config.getOrThrow<number>('OTP_MAX_ATTEMPTS');

    const pending = await this.prisma.otpRequest.findFirst({
      where: { phoneHash, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!pending || pending.attemptCount >= maxAttempts) {
      await this.auditLog.record({
        actorId: phoneHash,
        action: 'OTP_VERIFY_FAILED',
        metadata: {
          reason: !pending ? 'no_pending_otp' : 'max_attempts_exceeded',
        },
      });
      throw new UnauthorizedException('Invalid or expired OTP code.');
    }

    const isMatch = await this.crypto.verifyOtpCode(code, pending.codeHash);
    if (!isMatch) {
      await this.prisma.otpRequest.update({
        where: { id: pending.id },
        data: { attemptCount: { increment: 1 } },
      });
      await this.auditLog.record({
        actorId: phoneHash,
        action: 'OTP_VERIFY_FAILED',
        targetRef: pending.id,
        metadata: { reason: 'code_mismatch' },
      });
      throw new UnauthorizedException('Invalid or expired OTP code.');
    }

    await this.prisma.otpRequest.update({
      where: { id: pending.id },
      data: { consumedAt: new Date() },
    });

    return phoneHash;
  }
}
