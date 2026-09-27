import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchFeedbackService } from './match-feedback.service';

describe('MatchFeedbackService (FR-293..FR-295)', () => {
  let service: MatchFeedbackService;
  let prisma: {
    match: { findUnique: jest.Mock };
    matchFeedback: { upsert: jest.Mock; findUnique: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      match: { findUnique: jest.fn() },
      matchFeedback: { upsert: jest.fn(), findUnique: jest.fn() },
    };
    service = new MatchFeedbackService(prisma as unknown as PrismaService);
  });

  describe('submit', () => {
    it('throws NotFoundException for a match that does not exist', async () => {
      prisma.match.findUnique.mockResolvedValue(null);
      await expect(
        service.submit('user-1', 'match-1', 'RELEVANT', undefined),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.matchFeedback.upsert).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a real match the caller is not a participant of', async () => {
      prisma.match.findUnique.mockResolvedValue({
        id: 'match-1',
        userAId: 'someone-else',
        userBId: 'another-person',
      });
      await expect(
        service.submit('user-1', 'match-1', 'RELEVANT', undefined),
      ).rejects.toThrow(ForbiddenException);
    });

    it('upserts feedback for a real participant — a second submission updates, not duplicates (FR-293)', async () => {
      prisma.match.findUnique.mockResolvedValue({
        id: 'match-1',
        userAId: 'user-1',
        userBId: 'other-1',
      });
      prisma.matchFeedback.upsert.mockResolvedValue({
        rating: 'WRONG_MATCH',
        reasonCode: 'GOAL',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.submit('user-1', 'match-1', 'WRONG_MATCH', 'GOAL');

      expect(prisma.matchFeedback.upsert).toHaveBeenCalledWith({
        where: { matchId_userId: { matchId: 'match-1', userId: 'user-1' } },
        create: {
          matchId: 'match-1',
          userId: 'user-1',
          rating: 'WRONG_MATCH',
          reasonCode: 'GOAL',
        },
        update: { rating: 'WRONG_MATCH', reasonCode: 'GOAL' },
        select: {
          rating: true,
          reasonCode: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    it('works from either side of the match (userBId too)', async () => {
      prisma.match.findUnique.mockResolvedValue({
        id: 'match-1',
        userAId: 'other-1',
        userBId: 'user-1',
      });
      prisma.matchFeedback.upsert.mockResolvedValue({});

      await expect(
        service.submit('user-1', 'match-1', 'VERY_RELEVANT', undefined),
      ).resolves.toBeDefined();
    });
  });

  describe('getMine', () => {
    it('returns null when the caller has left no feedback yet', async () => {
      prisma.match.findUnique.mockResolvedValue({
        id: 'match-1',
        userAId: 'user-1',
        userBId: 'other-1',
      });
      prisma.matchFeedback.findUnique.mockResolvedValue(null);

      await expect(service.getMine('user-1', 'match-1')).resolves.toBeNull();
    });

    it('still gates on participation, even for a read', async () => {
      prisma.match.findUnique.mockResolvedValue({
        id: 'match-1',
        userAId: 'someone-else',
        userBId: 'another-person',
      });
      await expect(service.getMine('user-1', 'match-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
