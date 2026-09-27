import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/audit-log/audit-log.service';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

/** msFromDuration('30d') -> milliseconds. Supports s/m/h/d suffixes. */
function msFromDuration(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) throw new Error(`Invalid duration format: ${duration}`);
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]!;
  return value * unitMs;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** FR-7, FR-9: issue an access token and a new session-backed refresh token. */
  async issueTokens(
    userId: string,
    deviceInfo?: string,
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        // Cast: our env validation already restricts this to a duration string ('15m', '30d', ...).
        expiresIn: this.config.getOrThrow<string>(
          'JWT_ACCESS_EXPIRES_IN',
        ) as never,
      },
    );

    const refreshToken = this.crypto.generateOpaqueToken();
    await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: this.crypto.hashRefreshToken(refreshToken),
        deviceInfo,
      },
    });

    return { accessToken, refreshToken };
  }

  /** FR-8, FR-10: rotate a refresh token — old one is revoked, a new session is created. */
  async rotateRefreshToken(
    refreshToken: string,
    deviceInfo?: string,
  ): Promise<IssuedTokens> {
    const refreshTokenHash = this.crypto.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid or revoked refresh token.');
    }

    if (session.revokedAt) {
      // Real gap closed (2026-09-18 audit): this exact hash matched a real
      // session that was already rotated away — the classic stolen/replayed
      // refresh-token signature (a legitimate token is only ever presented
      // once; single-use rotation already guarantees that). Previously this
      // just 401'd with no further action, leaving every other still-valid
      // session for this user (including a legitimately-stolen-from one)
      // untouched. Per OWASP's own refresh-token reuse-detection guidance:
      // treat this as a real compromise signal and revoke every other
      // active session for this user, not just the one presented.
      //
      // Deliberately NOT triggered for a reuse detected within
      // REUSE_DETECTION_GRACE_MS of the original rotation — this project's
      // own docs/roadmap.md already documents a real, measured, accepted
      // race (a background refresh and a full-reload rehydration racing the
      // same not-yet-rotated cookie, observed 714ms apart) where the race's
      // *loser* legitimately re-presents an already-just-rotated token from
      // the same real user, not an attacker. Without this guard, the fix
      // below would turn that already-accepted, single-request 401 into a
      // full logout of every device — a real regression, not an improvement.
      // 10s is comfortably above the measured 714ms race window while far
      // too short to plausibly cover an attacker replaying a token some real
      // time after the legitimate rotation.
      const REUSE_DETECTION_GRACE_MS = 10_000;
      const msSinceRevoked = Date.now() - session.revokedAt.getTime();
      if (msSinceRevoked > REUSE_DETECTION_GRACE_MS) {
        await this.prisma.session.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.auditLog.record({
          actorId: session.userId,
          action: 'REFRESH_TOKEN_REUSE_DETECTED',
          metadata: { reusedSessionId: session.id, msSinceRevoked },
        });
      }
      throw new UnauthorizedException('Invalid or revoked refresh token.');
    }

    const refreshTtlMs = msFromDuration(
      this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    );
    if (session.createdAt.getTime() + refreshTtlMs < Date.now()) {
      throw new UnauthorizedException('Refresh token expired.');
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(
      session.userId,
      deviceInfo ?? session.deviceInfo ?? undefined,
    );
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const refreshTokenHash = this.crypto.hashRefreshToken(refreshToken);
    await this.prisma.session.updateMany({
      where: { refreshTokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyAccessToken(accessToken: string): Promise<{ sub: string }> {
    try {
      return await this.jwt.verifyAsync(accessToken, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }
}
