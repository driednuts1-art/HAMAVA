import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditLogEntry {
  /** User id for authenticated events, or a phoneHash for pre-auth events. Never a plaintext phone. */
  actorId?: string;
  action: string;
  targetRef?: string;
  metadata?: Record<string, unknown>;
}

/** Append-only trust/security event trail (product.md §9). */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditLogEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetRef: entry.targetRef,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
