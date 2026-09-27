import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReportReasonCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BlockService } from './block.service';
import { ReportService } from './report.service';
import { UserSafetyService } from './user-safety.service';

describe('UserSafetyService', () => {
  let service: UserSafetyService;
  let prisma: { user: { findUnique: jest.Mock } };
  let blockService: { block: jest.Mock };
  let reportService: { create: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'target-1' }) },
    };
    blockService = { block: jest.fn().mockResolvedValue(undefined) };
    reportService = { create: jest.fn().mockResolvedValue({ id: 'report-1' }) };

    service = new UserSafetyService(
      prisma as unknown as PrismaService,
      blockService as unknown as BlockService,
      reportService as unknown as ReportService,
    );
  });

  describe('block', () => {
    it('rejects targeting yourself (400)', async () => {
      await expect(service.block('user-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(blockService.block).not.toHaveBeenCalled();
    });

    it('rejects a target that does not exist (404)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.block('user-1', 'target-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(blockService.block).not.toHaveBeenCalled();
    });

    it('blocks the target — no match required (FR-71)', async () => {
      await service.block('user-1', 'target-1');
      expect(blockService.block).toHaveBeenCalledWith('user-1', 'target-1');
    });
  });

  describe('report', () => {
    it('rejects targeting yourself (400)', async () => {
      await expect(
        service.report('user-1', 'user-1', {
          category: ReportReasonCategory.SPAM,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(reportService.create).not.toHaveBeenCalled();
    });

    it('rejects a target that does not exist (404)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.report('user-1', 'target-1', {
          category: ReportReasonCategory.SPAM,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('reports the target — no match required (FR-71), no contextRef', async () => {
      await service.report('user-1', 'target-1', {
        category: ReportReasonCategory.FAKE_PROFILE,
        reason: undefined,
      });
      expect(reportService.create).toHaveBeenCalledWith(
        'user-1',
        'target-1',
        ReportReasonCategory.FAKE_PROFILE,
        undefined,
      );
    });
  });
});
