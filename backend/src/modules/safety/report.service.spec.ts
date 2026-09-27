import { NotFoundException } from '@nestjs/common';
import { ReportReasonCategory, ReportStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { ReportRateLimitService } from './report-rate-limit.service';
import { ReportService } from './report.service';

describe('ReportService', () => {
  let service: ReportService;
  let prisma: {
    report: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let auditLog: { record: jest.Mock };
  let rateLimit: { enforceCreate: jest.Mock };

  beforeEach(() => {
    prisma = {
      report: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    rateLimit = { enforceCreate: jest.fn().mockResolvedValue(undefined) };
    service = new ReportService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
      rateLimit as unknown as ReportRateLimitService,
    );
  });

  describe('create', () => {
    it('persists the report and writes a REPORT_SUBMITTED audit entry (FR-72, FR-73)', async () => {
      const created = { id: 'report-1' };
      prisma.report.create.mockResolvedValue(created);

      const result = await service.create(
        'reporter-1',
        'reported-1',
        ReportReasonCategory.SPAM,
        undefined,
        'match-1',
      );

      expect(result).toBe(created);
      expect(prisma.report.create).toHaveBeenCalledWith({
        data: {
          reporterId: 'reporter-1',
          reportedId: 'reported-1',
          category: ReportReasonCategory.SPAM,
          reason: undefined,
          contextRef: 'match-1',
        },
      });
      expect(auditLog.record).toHaveBeenCalledWith({
        actorId: 'reporter-1',
        action: 'REPORT_SUBMITTED',
        targetRef: 'reported-1',
        metadata: {
          category: ReportReasonCategory.SPAM,
          contextRef: 'match-1',
          reportId: 'report-1',
        },
      });
      expect(rateLimit.enforceCreate).toHaveBeenCalledWith('reporter-1');
    });

    it('never persists a report once the rate limit rejects it (mass-reporting-abuse gap closed 2026-09-18)', async () => {
      rateLimit.enforceCreate.mockRejectedValue(new Error('rate limited'));

      await expect(
        service.create('reporter-1', 'reported-1', ReportReasonCategory.SPAM),
      ).rejects.toThrow('rate limited');
      expect(prisma.report.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('filters by status and orders oldest-first, a real FIFO queue (FR-74)', async () => {
      prisma.report.findMany.mockResolvedValue([]);

      await service.list(ReportStatus.OPEN, undefined, 30);

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: ReportStatus.OPEN },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 30,
        }),
      );
    });

    it('omits the status filter when none is given', async () => {
      prisma.report.findMany.mockResolvedValue([]);
      await service.list(undefined, undefined, 30);
      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('resolve', () => {
    it('throws NotFoundException for a report that does not exist', async () => {
      prisma.report.findUnique.mockResolvedValue(null);
      await expect(
        service.resolve('missing-report', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.report.update).not.toHaveBeenCalled();
    });

    it('sets status/resolvedAt/resolvedByAdminId and audit-logs REPORT_RESOLVED (FR-75)', async () => {
      prisma.report.findUnique.mockResolvedValue({ id: 'report-1' });
      const resolved = { id: 'report-1', status: ReportStatus.RESOLVED };
      prisma.report.update.mockResolvedValue(resolved);

      const result = await service.resolve(
        'report-1',
        'admin-1',
        'looked into it',
      );

      expect(result).toBe(resolved);
      expect(prisma.report.update).toHaveBeenCalledWith({
        where: { id: 'report-1' },
        data: {
          status: ReportStatus.RESOLVED,
          resolvedAt: expect.any(Date),
          resolvedByAdminId: 'admin-1',
          resolutionNote: 'looked into it',
        },
      });
      expect(auditLog.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        action: 'REPORT_RESOLVED',
        targetRef: 'report-1',
        metadata: { resolutionNote: 'looked into it' },
      });
    });
  });
});
