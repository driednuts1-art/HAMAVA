import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BlockService } from '../safety/block.service';
import { ReportService } from '../safety/report.service';
import { ConversationAccessService } from './conversation-access.service';
import { ReportConversationDto } from './dto/report-conversation.dto';
import { STORAGE_PROVIDER } from '../profile/storage/storage-provider.interface';
import type { StorageProviderInterface } from '../profile/storage/storage-provider.interface';
import {
  PresenceService,
  type PresenceValue,
} from '../presence/presence.service';

export interface ConversationSummary {
  matchId: string;
  otherUser: {
    id: string;
    displayName: string | null;
    verified: boolean;
    primaryPhotoId: string | null;
    primaryPhotoUrl: string | null;
    /** Feature 27 (FR-485/FR-486): null when either party's showLastActiveStatus is off. */
    presence: PresenceValue | null;
  };
  lastMessage: { content: string; sentAt: Date; senderId: string } | null;
  unreadCount: number;
}

@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ConversationAccessService,
    private readonly blockService: BlockService,
    private readonly reportService: ReportService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProviderInterface,
    private readonly presenceService: PresenceService,
  ) {}

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const [matches, viewer] = await Promise.all([
      this.prisma.match.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        orderBy: { createdAt: 'desc' },
        include: {
          userA: {
            include: { photos: { orderBy: { position: 'asc' }, take: 1 } },
          },
          userB: {
            include: { photos: { orderBy: { position: 'asc' }, take: 1 } },
          },
          messages: { orderBy: { sentAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { showLastActiveStatus: true },
      }),
    ]);

    // FR-486: one batched Redis round trip for the whole list.
    const otherIds = matches.map((m) =>
      m.userAId === userId ? m.userBId : m.userAId,
    );
    const onlineMap = await this.presenceService.getOnlineMap(otherIds);

    const summaries = await Promise.all(
      matches.map(async (match): Promise<ConversationSummary | null> => {
        const other = match.userAId === userId ? match.userB : match.userA;

        // FR-68: hidden only from the blocking side — the blocked party's
        // own listing must stay unaffected (FR-69), so this check is
        // deliberately one-directional (caller-blocked-other), not isBlocked().
        if (await this.blockService.hasBlocked(userId, other.id)) {
          return null;
        }

        const unreadCount = await this.prisma.message.count({
          where: { matchId: match.id, senderId: other.id, readAt: null },
        });
        const lastMessage = match.messages[0];
        const primaryPhoto = other.photos[0];

        return {
          matchId: match.id,
          otherUser: {
            id: other.id,
            displayName: other.displayName,
            verified: other.livenessStatus,
            primaryPhotoId: primaryPhoto?.id ?? null,
            // FR-93: fresh on every call, same as the profile/deck endpoints.
            primaryPhotoUrl: primaryPhoto
              ? await this.storage.getUrl(primaryPhoto.storageKey)
              : null,
            presence: this.presenceService.buildPresenceField(
              viewer.showLastActiveStatus,
              other.showLastActiveStatus,
              onlineMap.get(other.id) ?? false,
              other.lastOnlineAt,
            ),
          },
          lastMessage: lastMessage
            ? {
                content: lastMessage.content,
                sentAt: lastMessage.sentAt,
                senderId: lastMessage.senderId,
              }
            : null,
          unreadCount,
        };
      }),
    );

    return summaries.filter(
      (summary): summary is ConversationSummary => summary !== null,
    );
  }

  /** FR-64: block is idempotent and bidirectional in effect. */
  async blockOtherParticipant(matchId: string, userId: string): Promise<void> {
    const match = await this.access.assertParticipant(matchId, userId);
    const otherId = this.access.otherParticipant(match, userId);
    await this.blockService.block(userId, otherId);
  }

  /**
   * FR-65 (Feature 4), FR-72/FR-73 (Feature 5): reachable from inside the
   * conversation, not just a profile/settings screen — deliberately uses
   * assertParticipant(), not assertAccessible(), so this stays reachable
   * even against a match the caller already blocked (FR-68).
   */
  async reportOtherParticipant(
    matchId: string,
    userId: string,
    dto: ReportConversationDto,
  ) {
    const match = await this.access.assertParticipant(matchId, userId);
    const otherId = this.access.otherParticipant(match, userId);
    const contextRef = dto.messageId ?? matchId;
    return this.reportService.create(
      userId,
      otherId,
      dto.category,
      dto.reason,
      contextRef,
    );
  }
}
