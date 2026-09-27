import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import { ReportRateLimitService } from './report-rate-limit.service';

const CONFIG: Record<string, number> = {
  REPORT_RATE_LIMIT_PER_HOUR: 10,
};

describe('ReportRateLimitService', () => {
  let service: ReportRateLimitService;
  let prisma: { report: { count: jest.Mock } };
  let auditLog: { record: jest.Mock };

  beforeEach(() => {
    prisma = { report: { count: jest.fn().mockResolvedValue(0) } };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new ReportRateLimitService(
      prisma as unknown as PrismaService,
      config,
      auditLog as unknown as AuditLogService,
    );
  });

  it('allows a report under the limit', async () => {
    await expect(service.enforceCreate('user-1')).resolves.toBeUndefined();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('rejects once the hourly limit is reached and audit-logs it', async () => {
    prisma.report.count.mockResolvedValue(10);
    await expect(service.enforceCreate('user-1')).rejects.toThrow(
      TooManyRequestsException,
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'REPORT_RATE_LIMIT_EXCEEDED',
        metadata: { limit: 10 },
      }),
    );
  });

  it("counts only this user's own submitted reports, independent of other users", async () => {
    prisma.report.count.mockResolvedValue(9);
    await service.enforceCreate('user-1');
    expect(prisma.report.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reporterId: 'user-1' }),
      }),
    );
  });
});
