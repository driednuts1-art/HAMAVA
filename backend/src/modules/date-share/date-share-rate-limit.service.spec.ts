import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import { DateShareRateLimitService } from './date-share-rate-limit.service';

const CONFIG: Record<string, number> = {
  DATE_SHARE_LINK_RATE_LIMIT_PER_DAY: 10,
  DATE_SHARE_LOOKUP_RATE_LIMIT_PER_IP_PER_MINUTE: 30,
};

describe('DateShareRateLimitService', () => {
  let service: DateShareRateLimitService;
  let prisma: {
    dateShareLink: Record<string, jest.Mock>;
    dateShareLinkLookupAttempt: Record<string, jest.Mock>;
  };
  let auditLog: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      dateShareLink: { count: jest.fn().mockResolvedValue(0) },
      dateShareLinkLookupAttempt: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new DateShareRateLimitService(
      prisma as unknown as PrismaService,
      config,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('enforceCreation (FR-168)', () => {
    it('allows a request under the limit', async () => {
      await expect(service.enforceCreation('user-1')).resolves.toBeUndefined();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('rejects once the daily limit is reached and audit-logs it', async () => {
      prisma.dateShareLink.count.mockResolvedValue(10);
      await expect(service.enforceCreation('user-1')).rejects.toThrow(
        TooManyRequestsException,
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'DATE_SHARE_LINK_RATE_LIMIT_EXCEEDED',
          metadata: { limit: 10 },
        }),
      );
    });
  });

  describe('enforceLookup (FR-169)', () => {
    it('allows a request under the limit and records it', async () => {
      await service.enforceLookup('1.2.3.4');
      expect(prisma.dateShareLinkLookupAttempt.create).toHaveBeenCalledWith({
        data: { ip: '1.2.3.4' },
      });
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('rejects once the per-IP limit is reached, without recording a further attempt', async () => {
      prisma.dateShareLinkLookupAttempt.count.mockResolvedValue(30);
      await expect(service.enforceLookup('1.2.3.4')).rejects.toThrow(
        TooManyRequestsException,
      );
      expect(prisma.dateShareLinkLookupAttempt.create).not.toHaveBeenCalled();
    });

    it('never includes the token in the audit-log entry (FR-167 — this axis only ever sees an IP anyway)', async () => {
      prisma.dateShareLinkLookupAttempt.count.mockResolvedValue(30);
      await expect(service.enforceLookup('1.2.3.4')).rejects.toThrow();
      const call = auditLog.record.mock.calls[0][0] as { metadata: unknown };
      expect(JSON.stringify(call.metadata)).not.toMatch(/token/i);
    });

    it('rate-limits independently per IP (a different IP is unaffected)', async () => {
      prisma.dateShareLinkLookupAttempt.count.mockImplementation(
        ({ where }: { where: { ip: string } }) =>
          Promise.resolve(where.ip === '1.2.3.4' ? 999 : 0),
      );
      await expect(service.enforceLookup('5.6.7.8')).resolves.toBeUndefined();
    });
  });
});
