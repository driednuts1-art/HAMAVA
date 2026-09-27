import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import { BoostService } from './boost.service';

const CONFIG: Record<string, number> = {
  BOOST_DURATION_MINUTES: 30,
  BOOST_RATE_LIMIT_PER_DAY: 1,
};

describe('BoostService (FR-126..FR-130)', () => {
  let service: BoostService;
  let prisma: { boost: Record<string, jest.Mock> };
  let auditLog: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      boost: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new BoostService(
      prisma as unknown as PrismaService,
      config,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('activate', () => {
    it('creates a boost with endsAt = now + BOOST_DURATION_MINUTES (FR-126)', async () => {
      const before = Date.now();
      prisma.boost.create.mockResolvedValue({
        endsAt: new Date(before + 30 * 60_000),
      });

      const result = await service.activate('user-1');

      expect(prisma.boost.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', endsAt: expect.any(Date) },
      });
      expect(result.active).toBe(true);
      const deltaMinutes = (result.endsAt!.getTime() - before) / 60_000;
      expect(deltaMinutes).toBeGreaterThan(29);
      expect(deltaMinutes).toBeLessThanOrEqual(30.5);
    });

    it('rejects with 409 when the caller already has an active boost — not stackable', async () => {
      prisma.boost.findFirst.mockResolvedValue({
        endsAt: new Date(Date.now() + 60_000),
      });

      await expect(service.activate('user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.boost.create).not.toHaveBeenCalled();
    });

    it('rejects once the daily rate limit is reached and audit-logs it (FR-130)', async () => {
      prisma.boost.count.mockResolvedValue(1);

      await expect(service.activate('user-1')).rejects.toThrow(
        TooManyRequestsException,
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'BOOST_RATE_LIMIT_EXCEEDED',
        }),
      );
      expect(prisma.boost.create).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('reports active:false with endsAt:null when there is no active boost (FR-127)', async () => {
      prisma.boost.findFirst.mockResolvedValue(null);
      await expect(service.getStatus('user-1')).resolves.toEqual({
        active: false,
        endsAt: null,
      });
    });

    it('reports active:true with the real remaining endsAt (FR-127)', async () => {
      const endsAt = new Date(Date.now() + 15 * 60_000);
      prisma.boost.findFirst.mockResolvedValue({ endsAt });
      await expect(service.getStatus('user-1')).resolves.toEqual({
        active: true,
        endsAt,
      });
    });

    it('queries only for boosts with endsAt in the future — an expired boost is not "active"', async () => {
      await service.getStatus('user-1');
      expect(prisma.boost.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', endsAt: { gt: expect.any(Date) } },
        }),
      );
    });
  });
});
