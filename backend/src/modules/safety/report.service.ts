import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReportReasonCategory, ReportStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { ReportRateLimitService } from './report-rate-limit.service';
import {
  decodeCursor,
  encodeCursor,
} from '../../common/pagination/cursor.util';

const DEFAULT_LIST_LIMIT = 30;

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly rateLimit: ReportRateLimitService,
  ) {}

  /**
   * FR-72, FR-73: categorized report, audit-logged on submission.
   * Real gap closed (2026-09-18 audit): every other user-triggered write in
   * this app has its own dedicated rate limit — reports didn't, making the
   * report system itself a real mass-reporting abuse vector against the
   * global 100/min throttle alone. Enforced here, not per call site, so
   * both real entry points (direct block/report via UserSafetyService, and
   * the chat-scoped report via ConversationService) are covered uniformly.
   */
  async create(
    reporterId: string,
    reportedId: string,
    category: ReportReasonCategory,
    reason?: string,
    contextRef?: string,
  ) {
    await this.rateLimit.enforceCreate(reporterId);

    const report = await this.prisma.report.create({
      data: { reporterId, reportedId, category, reason, contextRef },
    });
    await this.auditLog.record({
      actorId: reporterId,
      action: 'REPORT_SUBMITTED',
      targetRef: reportedId,
      metadata: { category, contextRef, reportId: report.id },
    });
    return report;
  }

  /** FR-74: the admin review queue — oldest-open-first, a real FIFO queue. */
  async list(
    status: ReportStatus | undefined,
    cursor: string | undefined,
    limit = DEFAULT_LIST_LIMIT,
  ) {
    const where: Prisma.ReportWhereInput = status ? { status } : {};

    if (cursor) {
      const decoded = decodeCursor(cursor);
      where.OR = [
        { createdAt: { gt: decoded.sortKey } },
        { createdAt: decoded.sortKey, id: { gt: decoded.id } },
      ];
    }

    const reports = await this.prisma.report.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    const last = reports.at(-1);
    const nextCursor =
      last && reports.length === limit
        ? encodeCursor(last.createdAt, last.id)
        : null;

    return { reports, nextCursor };
  }

  /**
   * FR-75: marks a report reviewed. This only records that a human looked at
   * it — it has no connection to any account-level enforcement action, none
   * of which exists in the codebase yet (docs/requirements.md Feature 5 §4).
   */
  async resolve(reportId: string, adminId: string, resolutionNote?: string) {
    const existing = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!existing) {
      throw new NotFoundException('Report not found.');
    }

    const resolved = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedByAdminId: adminId,
        resolutionNote,
      },
    });
    await this.auditLog.record({
      actorId: adminId,
      action: 'REPORT_RESOLVED',
      targetRef: reportId,
      metadata: { resolutionNote },
    });
    return resolved;
  }
}
