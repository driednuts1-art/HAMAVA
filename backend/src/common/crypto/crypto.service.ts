import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';

const OTP_SALT_ROUNDS = 10;

/**
 * Central place for the hashing/token-generation primitives required by
 * product.md §5: phone numbers, OTP codes, and refresh tokens are stored only
 * as hashes, never in plaintext.
 *
 * Phone numbers and refresh tokens are hashed with a keyed HMAC — both need
 * a deterministic hash for an indexed DB lookup (`WHERE phoneHash = ...`),
 * which a randomly-salted algorithm like bcrypt cannot support. bcrypt is
 * used for the OTP code specifically because it's the one low-entropy,
 * offline-brute-forceable secret here (6 digits = 1,000,000 possibilities);
 * bcrypt's deliberately slow, salted hashing (plus a secret pepper on top)
 * makes offline cracking of a stolen OTP hash impractical, and verification
 * only ever needs a single hash-vs-plaintext compare, not a lookup by hash.
 */
@Injectable()
export class CryptoService {
  constructor(private readonly config: ConfigService) {}

  private hmac(value: string, secret: string): string {
    return createHmac('sha256', secret).update(value).digest('hex');
  }

  hashPhone(phoneE164: string): string {
    return this.hmac(
      phoneE164,
      this.config.getOrThrow<string>('PHONE_HASH_SECRET'),
    );
  }

  hashOtpCode(code: string): Promise<string> {
    const pepper = this.config.getOrThrow<string>('OTP_CODE_HASH_SECRET');
    return bcrypt.hash(`${pepper}:${code}`, OTP_SALT_ROUNDS);
  }

  verifyOtpCode(code: string, hash: string): Promise<boolean> {
    const pepper = this.config.getOrThrow<string>('OTP_CODE_HASH_SECRET');
    return bcrypt.compare(`${pepper}:${code}`, hash);
  }

  hashRefreshToken(token: string): string {
    return this.hmac(
      token,
      this.config.getOrThrow<string>('REFRESH_TOKEN_HASH_SECRET'),
    );
  }

  /** Feature 12 (FR-159): same shape as hashRefreshToken(), a dedicated secret so a compromise of one doesn't affect the other. */
  hashShareToken(token: string): string {
    return this.hmac(
      token,
      this.config.getOrThrow<string>('DATE_SHARE_TOKEN_HASH_SECRET'),
    );
  }

  generateOtpCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  generateOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
