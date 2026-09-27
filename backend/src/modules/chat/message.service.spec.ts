import { ConfigService } from '@nestjs/config';
import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import type { ContentModerationProviderInterface } from '../../common/moderation/content-moderation-provider.interface';
import type { ModerationFlagService } from '../../common/moderation/moderation-flag.service';
import { BlockService } from '../safety/block.service';
import { ConversationAccessService } from './conversation-access.service';
import { ChatGateway } from './chat.gateway';
import { MessageService } from './message.service';

const CONFIG: Record<string, number> = { MESSAGE_RATE_LIMIT_PER_MINUTE: 60 };
const MATCH = { id: 'match-1', userAId: 'sender-1', userBId: 'recipient-1' };

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '0.0.0',
  });
}

describe('MessageService', () => {
  let service: MessageService;
  let prisma: {
    message: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let access: { assertAccessible: jest.Mock; otherParticipant: jest.Mock };
  let blockService: { hasBlocked: jest.Mock };
  let auditLog: { record: jest.Mock };
  let gateway: { pushNewMessage: jest.Mock };
  let moderation: jest.Mocked<ContentModerationProviderInterface>;
  let moderationFlags: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      message: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    access = {
      assertAccessible: jest.fn().mockResolvedValue(MATCH),
      otherParticipant: jest.fn().mockReturnValue('recipient-1'),
    };
    // FR-70: the sender's own block-checked path is assertAccessible()
    // (see conversation-access.service.spec.ts); hasBlocked() here is only
    // ever consulted the *other* direction, to decide push suppression.
    blockService = { hasBlocked: jest.fn().mockResolvedValue(false) };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    gateway = { pushNewMessage: jest.fn() };
    moderation = {
      moderateImage: jest.fn(),
      moderateText: jest.fn().mockResolvedValue({ approved: true }),
    };
    moderationFlags = { record: jest.fn().mockResolvedValue({ id: 'flag-1' }) };

    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new MessageService(
      prisma as unknown as PrismaService,
      config,
      access as unknown as ConversationAccessService,
      blockService as unknown as BlockService,
      auditLog as unknown as AuditLogService,
      gateway as unknown as ChatGateway,
      moderation,
      moderationFlags as unknown as ModerationFlagService,
    );
  });

  describe('sendMessage', () => {
    const dto = {
      content: 'hi',
      clientIdempotencyKey: '11111111-1111-1111-1111-111111111111',
    };

    it('is match-gated (FR-53), and denies the sender outright if they blocked the recipient (FR-68) — propagates whatever assertAccessible throws', async () => {
      access.assertAccessible.mockRejectedValue(new Error('not a participant'));
      await expect(
        service.sendMessage('match-1', 'sender-1', dto),
      ).rejects.toThrow('not a participant');
    });

    it('returns the existing message on a retried idempotency key, skipping all other checks (FR-54)', async () => {
      const existing = { id: 'msg-1' };
      prisma.message.findUnique.mockResolvedValue(existing);

      const result = await service.sendMessage('match-1', 'sender-1', dto);

      expect(result).toBe(existing);
      expect(moderation.moderateText).not.toHaveBeenCalled();
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('succeeds normally and persists when the recipient blocked the sender, with no distinct error path (FR-69, FR-70)', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      const created = { id: 'msg-1', senderId: 'sender-1' };
      prisma.message.create.mockResolvedValue(created);
      blockService.hasBlocked.mockResolvedValue(true); // recipient blocked sender

      const result = await service.sendMessage('match-1', 'sender-1', dto);

      expect(result).toBe(created);
      expect(prisma.message.create).toHaveBeenCalled();
    });

    it('suppresses the WebSocket push, silently, when the recipient blocked the sender (FR-70)', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      const created = { id: 'msg-1', senderId: 'sender-1' };
      prisma.message.create.mockResolvedValue(created);
      blockService.hasBlocked.mockResolvedValue(true);

      await service.sendMessage('match-1', 'sender-1', dto);

      expect(blockService.hasBlocked).toHaveBeenCalledWith(
        'recipient-1',
        'sender-1',
      );
      expect(gateway.pushNewMessage).not.toHaveBeenCalled();
    });

    it('rejects and audit-logs when the sender is rate-limited (FR-57)', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      prisma.message.count.mockResolvedValue(60);

      await expect(
        service.sendMessage('match-1', 'sender-1', dto),
      ).rejects.toThrow(TooManyRequestsException);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'sender-1',
          action: 'MESSAGE_RATE_LIMIT_EXCEEDED',
        }),
      );
    });

    it('rejects and audit-logs content that fails moderation (FR-56)', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      moderation.moderateText.mockResolvedValue({
        approved: false,
        reason: 'scam pattern',
      });

      await expect(
        service.sendMessage('match-1', 'sender-1', dto),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'MESSAGE_TEXT_MODERATION_REJECTED' }),
      );
      expect(prisma.message.create).not.toHaveBeenCalled();
      // FR-97: retained for human review — a rejected message is otherwise never persisted.
      expect(moderationFlags.record).toHaveBeenCalledWith({
        userId: 'sender-1',
        contentType: 'MESSAGE',
        textContent: dto.content,
        reason: 'scam pattern',
        contextRef: 'match-1',
      });
    });

    it('persists and pushes to the recipient over the gateway on success (FR-58)', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      const created = { id: 'msg-1', senderId: 'sender-1' };
      prisma.message.create.mockResolvedValue(created);

      const result = await service.sendMessage('match-1', 'sender-1', dto);

      expect(result).toBe(created);
      expect(gateway.pushNewMessage).toHaveBeenCalledWith(
        'recipient-1',
        created,
      );
    });

    it('a real Redis outage during the live push never fails the send — the message is already persisted and still returned (docs/roadmap.md)', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      const created = { id: 'msg-1', senderId: 'sender-1' };
      prisma.message.create.mockResolvedValue(created);
      gateway.pushNewMessage.mockImplementation(() => {
        throw new Error('Redis pub client error: getaddrinfo ENOTFOUND');
      });

      const result = await service.sendMessage('match-1', 'sender-1', dto);

      expect(result).toBe(created);
      expect(gateway.pushNewMessage).toHaveBeenCalledWith(
        'recipient-1',
        created,
      );
    });

    it('recovers from a concurrent duplicate insert on the same idempotency key instead of erroring', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      prisma.message.create.mockRejectedValue(uniqueViolation());
      const winner = { id: 'msg-1' };
      prisma.message.findUniqueOrThrow.mockResolvedValue(winner);

      await expect(
        service.sendMessage('match-1', 'sender-1', dto),
      ).resolves.toBe(winner);
    });
  });

  describe('getHistory', () => {
    it('is match-gated (FR-53) and denies the caller if they blocked the other participant (FR-68)', async () => {
      access.assertAccessible.mockRejectedValue(new Error('nope'));
      await expect(
        service.getHistory('match-1', 'sender-1', { limit: 30 }),
      ).rejects.toThrow('nope');
    });

    it('returns null nextCursor when fewer than `limit` rows come back', async () => {
      prisma.message.findMany.mockResolvedValue([
        { id: 'a', sentAt: new Date() },
      ]);
      const result = await service.getHistory('match-1', 'sender-1', {
        limit: 30,
      });
      expect(result.nextCursor).toBeNull();
    });

    it('orders newest-first (FR-62)', async () => {
      prisma.message.findMany.mockResolvedValue([]);
      await service.getHistory('match-1', 'sender-1', { limit: 30 });
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });
  });

  describe('markRead', () => {
    it("is match-gated (FR-53) and only touches the other participant's unread messages", async () => {
      await service.markRead('match-1', 'sender-1');
      expect(prisma.message.updateMany).toHaveBeenCalledWith({
        where: { matchId: 'match-1', senderId: 'recipient-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });
});
