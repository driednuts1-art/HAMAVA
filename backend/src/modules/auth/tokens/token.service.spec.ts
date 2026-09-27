import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/audit-log/audit-log.service';
import { TokenService } from './token.service';

const CONFIG: Record<string, string> = {
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '30d',
};

// No unit test existed for TokenService at all before this pass (2026-09-18
// audit) — every prior guarantee about rotation/reuse/expiry was covered
// only indirectly through e2e suites. Added here specifically because this
// file now also carries the new reuse-detection logic, which needs precise,
// fast, time-controlled coverage a real e2e test can't give cheaply.
describe('TokenService', () => {
  let service: TokenService;
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let crypto: {
    generateOpaqueToken: jest.Mock;
    hashRefreshToken: jest.Mock;
  };
  let prisma: {
    session: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let auditLog: { record: jest.Mock };
  let config: ConfigService;

  beforeEach(() => {
    jwt = {
      signAsync: jest.fn().mockResolvedValue('signed-access-token'),
      verifyAsync: jest.fn(),
    };
    crypto = {
      generateOpaqueToken: jest.fn().mockReturnValue('raw-refresh-token'),
      hashRefreshToken: jest.fn((t: string) => `hash(${t})`),
    };
    prisma = {
      session: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new TokenService(
      jwt as unknown as JwtService,
      config,
      crypto as unknown as CryptoService,
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('issueTokens', () => {
    it('signs an access token and persists a hashed refresh-token session (FR-7, FR-9)', async () => {
      const result = await service.issueTokens('user-1', 'device-A');

      expect(result).toEqual({
        accessToken: 'signed-access-token',
        refreshToken: 'raw-refresh-token',
      });
      expect(prisma.session.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          refreshTokenHash: 'hash(raw-refresh-token)',
          deviceInfo: 'device-A',
        },
      });
      // The raw refresh token is never itself persisted — only its hash.
      expect(
        prisma.session.create.mock.calls[0][0].data.refreshTokenHash,
      ).not.toBe('raw-refresh-token');
    });
  });

  describe('rotateRefreshToken', () => {
    const activeSession = {
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
      createdAt: new Date(),
      deviceInfo: 'device-A',
    };

    it('rejects a refresh token matching no real session', async () => {
      prisma.session.findUnique.mockResolvedValue(null);
      await expect(service.rotateRefreshToken('bogus')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('rejects an expired (but never rotated) refresh token, without touching other sessions', async () => {
      prisma.session.findUnique.mockResolvedValue({
        ...activeSession,
        createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), // 31 days old
      });
      await expect(service.rotateRefreshToken('raw')).rejects.toThrow(
        'Refresh token expired.',
      );
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
    });

    it('rotates a valid token: revokes it and issues a fresh session (FR-8, FR-10)', async () => {
      prisma.session.findUnique.mockResolvedValue(activeSession);

      const result = await service.rotateRefreshToken('raw');

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.accessToken).toBe('signed-access-token');
      expect(prisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1' }),
        }),
      );
    });

    it('a token reused well after its rotation triggers family-wide revocation and an audit event (real gap closed 2026-09-18)', async () => {
      const revokedAt = new Date(Date.now() - 60_000); // 60s ago — well past the 10s race-grace window
      prisma.session.findUnique.mockResolvedValue({
        ...activeSession,
        revokedAt,
      });

      await expect(service.rotateRefreshToken('raw')).rejects.toThrow(
        'Invalid or revoked refresh token.',
      );

      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'REFRESH_TOKEN_REUSE_DETECTED',
          metadata: expect.objectContaining({ reusedSessionId: 'session-1' }),
        }),
      );
      // Never issues new tokens for a reused/revoked token.
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('a token reused within the known 714ms double-navigation race window does NOT trigger family-wide revocation (docs/roadmap.md — must not regress this already-accepted race)', async () => {
      const revokedAt = new Date(Date.now() - 700); // within the 10s grace window
      prisma.session.findUnique.mockResolvedValue({
        ...activeSession,
        revokedAt,
      });

      await expect(service.rotateRefreshToken('raw')).rejects.toThrow(
        'Invalid or revoked refresh token.',
      );

      expect(prisma.session.updateMany).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });

  describe('revokeRefreshToken', () => {
    it('revokes only the matching, still-active session', async () => {
      await service.revokeRefreshToken('raw');
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { refreshTokenHash: 'hash(raw)', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('verifyAccessToken', () => {
    it('returns the decoded payload for a valid token', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      await expect(service.verifyAccessToken('valid')).resolves.toEqual({
        sub: 'user-1',
      });
    });

    it('rejects an invalid/expired token with a generic message', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      await expect(service.verifyAccessToken('bad')).rejects.toThrow(
        'Invalid or expired access token.',
      );
    });
  });
});
