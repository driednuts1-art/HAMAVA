import { ReportReasonCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BlockService } from '../safety/block.service';
import { ReportService } from '../safety/report.service';
import { ConversationAccessService } from './conversation-access.service';
import { ConversationService } from './conversation.service';
import type { StorageProviderInterface } from '../profile/storage/storage-provider.interface';
import type { PresenceService } from '../presence/presence.service';

const MATCH = { id: 'match-1', userAId: 'user-a', userBId: 'user-b' };

describe('ConversationService', () => {
  let service: ConversationService;
  let prisma: {
    match: { findMany: jest.Mock };
    message: { count: jest.Mock };
    user: { findUniqueOrThrow: jest.Mock };
  };
  let access: { assertParticipant: jest.Mock; otherParticipant: jest.Mock };
  let blockService: { block: jest.Mock; hasBlocked: jest.Mock };
  let reportService: { create: jest.Mock };
  let storage: { getUrl: jest.Mock };
  let presenceService: {
    getOnlineMap: jest.Mock;
    buildPresenceField: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      match: { findMany: jest.fn() },
      message: { count: jest.fn().mockResolvedValue(0) },
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ showLastActiveStatus: true }),
      },
    };
    presenceService = {
      getOnlineMap: jest.fn().mockResolvedValue(new Map()),
      buildPresenceField: jest.fn().mockReturnValue(null),
    };
    access = {
      assertParticipant: jest.fn().mockResolvedValue(MATCH),
      otherParticipant: jest.fn().mockReturnValue('user-b'),
    };
    blockService = {
      block: jest.fn().mockResolvedValue(undefined),
      hasBlocked: jest.fn().mockResolvedValue(false),
    };
    reportService = { create: jest.fn().mockResolvedValue({ id: 'report-1' }) };
    storage = {
      getUrl: jest.fn().mockResolvedValue('https://storage.example/signed-url'),
    };

    service = new ConversationService(
      prisma as unknown as PrismaService,
      access as unknown as ConversationAccessService,
      blockService as unknown as BlockService,
      reportService as unknown as ReportService,
      storage as unknown as StorageProviderInterface,
      presenceService as unknown as PresenceService,
    );
  });

  describe('listConversations', () => {
    it('maps each match to the *other* user, with last message and unread count', async () => {
      prisma.match.findMany.mockResolvedValue([
        {
          id: 'match-1',
          userAId: 'me',
          userBId: 'them',
          userA: {
            id: 'me',
            displayName: 'Me',
            livenessStatus: true,
            photos: [],
          },
          userB: {
            id: 'them',
            displayName: 'Them',
            livenessStatus: false,
            photos: [{ id: 'photo-1', storageKey: 'key-1' }],
          },
          messages: [{ content: 'hi', sentAt: new Date(), senderId: 'them' }],
        },
      ]);
      prisma.message.count.mockResolvedValue(2);

      const result = await service.listConversations('me');

      expect(result).toHaveLength(1);
      expect(result[0].otherUser.id).toBe('them');
      expect(result[0].otherUser.primaryPhotoId).toBe('photo-1');
      expect(result[0].otherUser.primaryPhotoUrl).toBe(
        'https://storage.example/signed-url',
      );
      expect(storage.getUrl).toHaveBeenCalledWith('key-1');
      expect(result[0].lastMessage?.content).toBe('hi');
      expect(result[0].unreadCount).toBe(2);
    });

    it('returns null primaryPhotoUrl (and never calls storage) when the other user has no photo', async () => {
      prisma.match.findMany.mockResolvedValue([
        {
          id: 'match-1',
          userAId: 'me',
          userBId: 'them',
          userA: {
            id: 'me',
            displayName: 'Me',
            livenessStatus: true,
            photos: [],
          },
          userB: {
            id: 'them',
            displayName: 'Them',
            livenessStatus: false,
            photos: [],
          },
          messages: [],
        },
      ]);

      const result = await service.listConversations('me');

      expect(result[0].otherUser.primaryPhotoId).toBeNull();
      expect(result[0].otherUser.primaryPhotoUrl).toBeNull();
      expect(storage.getUrl).not.toHaveBeenCalled();
    });

    it('reports null lastMessage when the conversation has none yet', async () => {
      prisma.match.findMany.mockResolvedValue([
        {
          id: 'match-1',
          userAId: 'me',
          userBId: 'them',
          userA: {
            id: 'me',
            displayName: 'Me',
            livenessStatus: true,
            photos: [],
          },
          userB: {
            id: 'them',
            displayName: 'Them',
            livenessStatus: false,
            photos: [],
          },
          messages: [],
        },
      ]);

      const result = await service.listConversations('me');
      expect(result[0].lastMessage).toBeNull();
    });

    it('excludes a match the caller has blocked (FR-68), directionally not bidirectionally', async () => {
      prisma.match.findMany.mockResolvedValue([
        {
          id: 'match-1',
          userAId: 'me',
          userBId: 'them',
          userA: {
            id: 'me',
            displayName: 'Me',
            livenessStatus: true,
            photos: [],
          },
          userB: {
            id: 'them',
            displayName: 'Them',
            livenessStatus: false,
            photos: [],
          },
          messages: [],
        },
      ]);
      blockService.hasBlocked.mockResolvedValue(true);

      const result = await service.listConversations('me');

      expect(result).toHaveLength(0);
      expect(blockService.hasBlocked).toHaveBeenCalledWith('me', 'them');
    });
  });

  describe('blockOtherParticipant', () => {
    it('is match-gated and blocks the *other* participant, not the caller', async () => {
      await service.blockOtherParticipant('match-1', 'user-a');
      expect(access.assertParticipant).toHaveBeenCalledWith(
        'match-1',
        'user-a',
      );
      expect(blockService.block).toHaveBeenCalledWith('user-a', 'user-b');
    });
  });

  describe('reportOtherParticipant', () => {
    it('defaults contextRef to the matchId when no messageId is given (FR-65)', async () => {
      await service.reportOtherParticipant('match-1', 'user-a', {
        category: ReportReasonCategory.HARASSMENT,
      });
      expect(reportService.create).toHaveBeenCalledWith(
        'user-a',
        'user-b',
        ReportReasonCategory.HARASSMENT,
        undefined,
        'match-1',
      );
    });

    it('prefers a specific messageId as contextRef when given', async () => {
      await service.reportOtherParticipant('match-1', 'user-a', {
        category: ReportReasonCategory.HARASSMENT,
        messageId: 'msg-1',
      });
      expect(reportService.create).toHaveBeenCalledWith(
        'user-a',
        'user-b',
        ReportReasonCategory.HARASSMENT,
        undefined,
        'msg-1',
      );
    });

    it('uses assertParticipant, not assertAccessible, so report stays reachable even against a blocked match (FR-68)', async () => {
      await service.reportOtherParticipant('match-1', 'user-a', {
        category: ReportReasonCategory.SPAM,
      });
      expect(access.assertParticipant).toHaveBeenCalledWith(
        'match-1',
        'user-a',
      );
    });
  });
});
