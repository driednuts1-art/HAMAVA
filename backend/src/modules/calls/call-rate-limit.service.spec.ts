import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import { CallRateLimitService } from './call-rate-limit.service';

const CONFIG: Record<string, number> = {
  CALL_START_RATE_LIMIT_PER_HOUR: 20,
};

describe('CallRateLimitService', () => {
  let service: CallRateLimitService;
  let prisma: { callSession: { count: jest.Mock } };
  let auditLog: { record: jest.Mock };

  beforeEach(() => {
    prisma = { callSession: { count: jest.fn().mockResolvedValue(0) } };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new CallRateLimitService(
      prisma as unknown as PrismaService,
      config,
      auditLog as unknown as AuditLogService,
    );
  });

  it('allows a call start under the limit', async () => {
    await expect(service.enforceStart('user-1')).resolves.toBeUndefined();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('rejects once the hourly limit is reached and audit-logs it (FR-196)', async () => {
    prisma.callSession.count.mockResolvedValue(20);
    await expect(service.enforceStart('user-1')).rejects.toThrow(
      TooManyRequestsException,
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'CALL_RATE_LIMIT_EXCEEDED',
        metadata: { limit: 20 },
      }),
    );
  });

  it("counts only this user's own initiated calls, independent of other users", async () => {
    prisma.callSession.count.mockResolvedValue(19);
    await service.enforceStart('user-1');
    expect(prisma.callSession.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ initiatorId: 'user-1' }),
      }),
    );
  });
});
