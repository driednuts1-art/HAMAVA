import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ModerationContentType,
  ModerationFlagResolution,
  ModerationFlagStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { decodeCursor, encodeCursor } from '../pagination/cursor.util';
import { STORAGE_PROVIDER } from '../../modules/profile/storage/storage-provider.interface';
import type { StorageProviderInterface } from '../../modules/profile/storage/storage-provider.interface';

const DEFAULT_LIST_LIMIT = 30;

interface RecordFlagParams {
  userId: string;
  contentType: ModerationContentType;
  reason?: string;
  contextRef?: string;
  /** BIO_TEXT / MESSAGE — the rejected text, never persisted anywhere else. */
  textContent?: string;
  /** PHOTO — the already-processed image bytes, quarantined under their own key. */
  imageData?: Buffer;
}

/**
 * FR-97..FR-99: creates a review record on every moderation rejection (the
 * only reason a human review queue has anything to show at all — rejected
 * content is never persisted anywhere else), and the admin list/resolve
 * surface over it. Deliberately mirrors ReportService's exact shape
 * (Feature 5) — same FIFO cursor pagination, same resolve pattern.
 */
@Injectable()
export class ModerationFlagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProviderInterface,
  ) {}

  /** FR-97: called from all three moderation call sites on rejection. */
  async record(params: RecordFlagParams) {
    let quarantineStorageKey: string | undefined;
    if (params.imageData) {
      // A distinct prefix — never the same key space a published Photo uses.
      quarantineStorageKey = `flagged/${randomUUID()}.webp`;
      await this.storage.save(
        quarantineStorageKey,
        params.imageData,
        'image/webp',
      );
    }

    return this.prisma.moderationFlag.create({
      data: {
        userId: params.userId,
        contentType: params.contentType,
        textContent: params.textContent,
        quarantineStorageKey,
        reason: params.reason,
        contextRef: params.contextRef,
      },
    });
  }

  /** FR-98: the admin review queue — oldest-open-first, a real FIFO queue. */
  async list(
    status: ModerationFlagStatus | undefined,
    cursor: string | undefined,
    limit = DEFAULT_LIST_LIMIT,
  ) {
    const where: Prisma.ModerationFlagWhereInput = status ? { status } : {};

    if (cursor) {
      const decoded = decodeCursor(cursor);
      where.OR = [
        { createdAt: { gt: decoded.sortKey } },
        { createdAt: decoded.sortKey, id: { gt: decoded.id } },
      ];
    }

    const flags = await this.prisma.moderationFlag.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    // FR-98: a flagged photo is only viewable via the same presigned,
    // time-limited mechanism Feature 7 built — never a permanent link.
    const flagsWithUrls = await Promise.all(
      flags.map(async (flag) => ({
        ...flag,
        quarantineUrl: flag.quarantineStorageKey
          ? await this.storage.getUrl(flag.quarantineStorageKey)
          : null,
      })),
    );

    const last = flags.at(-1);
    const nextCursor =
      last && flags.length === limit
        ? encodeCursor(last.createdAt, last.id)
        : null;

    return { flags: flagsWithUrls, nextCursor };
  }

  /**
   * FR-99: records a human verdict on the vendor's original rejection. This
   * is an accountability record only — it never republishes the content
   * (docs/requirements.md Feature 8 §4) and has no connection to any
   * account-level enforcement action, the same posture Feature 5 already
   * established for report resolution.
   */
  async resolve(
    flagId: string,
    adminId: string,
    resolution: ModerationFlagResolution,
    resolutionNote?: string,
  ) {
    const existing = await this.prisma.moderationFlag.findUnique({
      where: { id: flagId },
    });
    if (!existing) {
      throw new NotFoundException('Moderation flag not found.');
    }

    const resolved = await this.prisma.moderationFlag.update({
      where: { id: flagId },
      data: {
        status: ModerationFlagStatus.RESOLVED,
        resolution,
        resolutionNote,
        resolvedAt: new Date(),
        resolvedByAdminId: adminId,
      },
    });
    await this.auditLog.record({
      actorId: adminId,
      action: 'MODERATION_FLAG_RESOLVED',
      targetRef: flagId,
      metadata: { resolution, resolutionNote },
    });
    return resolved;
  }
}
