import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BlockService } from '../safety/block.service';
import { ConversationAccessService } from './conversation-access.service';

describe('ConversationAccessService', () => {
  let service: ConversationAccessService;
  let prisma: { match: { findUnique: jest.Mock } };
  let blockService: { hasBlocked: jest.Mock };

  beforeEach(() => {
    prisma = { match: { findUnique: jest.fn() } };
    blockService = { hasBlocked: jest.fn().mockResolvedValue(false) };
    service = new ConversationAccessService(
      prisma as unknown as PrismaService,
      blockService as unknown as BlockService,
    );
  });

  describe('assertParticipant', () => {
    it('rejects a match that does not exist (FR-53)', async () => {
      prisma.match.findUnique.mockResolvedValue(null);
      await expect(
        service.assertParticipant('match-1', 'user-a'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a caller who is not a participant (FR-53)', async () => {
      prisma.match.findUnique.mockResolvedValue({
        id: 'match-1',
        userAId: 'user-a',
        userBId: 'user-b',
      });
      await expect(
        service.assertParticipant('match-1', 'user-c'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns the match for either participant', async () => {
      const match = { id: 'match-1', userAId: 'user-a', userBId: 'user-b' };
      prisma.match.findUnique.mockResolvedValue(match);
      await expect(
        service.assertParticipant('match-1', 'user-a'),
      ).resolves.toEqual(match);
      await expect(
        service.assertParticipant('match-1', 'user-b'),
      ).resolves.toEqual(match);
    });
  });

  describe('otherParticipant', () => {
    it('returns userB when called as userA and vice versa', () => {
      const match = { userAId: 'user-a', userBId: 'user-b' };
      expect(service.otherParticipant(match, 'user-a')).toBe('user-b');
      expect(service.otherParticipant(match, 'user-b')).toBe('user-a');
    });
  });

  describe('assertAccessible', () => {
    it('denies the caller as if the match does not exist when they blocked the other participant (FR-68)', async () => {
      prisma.match.findUnique.mockResolvedValue({
        id: 'match-1',
        userAId: 'user-a',
        userBId: 'user-b',
      });
      blockService.hasBlocked.mockResolvedValue(true);

      await expect(
        service.assertAccessible('match-1', 'user-a'),
      ).rejects.toThrow(NotFoundException);
      expect(blockService.hasBlocked).toHaveBeenCalledWith('user-a', 'user-b');
    });

    it('grants access normally to the blocked party — no sign of the block (FR-69)', async () => {
      const match = { id: 'match-1', userAId: 'user-a', userBId: 'user-b' };
      prisma.match.findUnique.mockResolvedValue(match);
      // user-a blocked user-b; asking as user-b (the blocked party) must
      // not be denied — hasBlocked('user-b', 'user-a') is false, since the
      // Block row records user-a as the blocker, not user-b.
      blockService.hasBlocked.mockResolvedValue(false);

      await expect(
        service.assertAccessible('match-1', 'user-b'),
      ).resolves.toEqual(match);
      expect(blockService.hasBlocked).toHaveBeenCalledWith('user-b', 'user-a');
    });
  });
});
