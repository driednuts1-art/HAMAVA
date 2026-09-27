import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SwipeAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import { SwipeService } from './swipe.service';
import type { MatchExplanationService } from './match-explanation/match-explanation.service';

const CONFIG: Record<string, number> = { SWIPE_RATE_LIMIT_PER_MINUTE: 60 };

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '0.0.0',
  });
}

function transactionManagerError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Transaction API error: Unable to start a transaction in the given time.',
    { code: 'P2028', clientVersion: '0.0.0' },
  );
}

describe('SwipeService', () => {
  let service: SwipeService;
  let tx: {
    swipe: { create: jest.Mock; findUnique: jest.Mock };
    match: { create: jest.Mock; findUniqueOrThrow: jest.Mock };
    block: { findFirst: jest.Mock };
    user: { findUniqueOrThrow: jest.Mock };
  };
  let prisma: {
    user: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
    swipe: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let auditLog: { record: jest.Mock };
  let matchExplanation: { generate: jest.Mock };

  beforeEach(() => {
    tx = {
      swipe: { create: jest.fn(), findUnique: jest.fn() },
      match: { create: jest.fn(), findUniqueOrThrow: jest.fn() },
      block: { findFirst: jest.fn().mockResolvedValue(null) },
      // Feature 6 (FR-79) defense-in-depth check — default to no restriction
      // on either side so pre-existing match-creation tests are unaffected.
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          livenessStatus: true,
          messagingPermission: 'EVERYONE',
        }),
      },
    };
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'target-1',
          livenessStatus: true,
          messagingPermission: 'EVERYONE',
        }),
        // FR-124: only ever queried for SUPER_LIKE (the actor's own facts).
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'user-1',
          displayName: 'Actor',
          birthDate: null,
          city: null,
          bio: null,
          interests: [],
          datingIntent: null,
        }),
      },
      swipe: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    matchExplanation = { generate: jest.fn().mockResolvedValue(null) };

    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new SwipeService(
      prisma as unknown as PrismaService,
      config,
      auditLog as unknown as AuditLogService,
      matchExplanation as unknown as MatchExplanationService,
    );
  });

  it('rejects swiping on yourself', async () => {
    await expect(
      service.recordSwipe('user-1', 'user-1', SwipeAction.LIKE),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when rate limit is exceeded and audit-logs it (FR-50)', async () => {
    prisma.swipe.count.mockResolvedValue(60);
    await expect(
      service.recordSwipe('user-1', 'target-1', SwipeAction.LIKE),
    ).rejects.toThrow(TooManyRequestsException);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'SWIPE_RATE_LIMIT_EXCEEDED',
      }),
    );
  });

  it('rejects when the target does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.recordSwipe('user-1', 'target-1', SwipeAction.LIKE),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a duplicate swipe on the same target (FR-40)', async () => {
    tx.swipe.create.mockRejectedValue(uniqueViolation());
    await expect(
      service.recordSwipe('user-1', 'target-1', SwipeAction.LIKE),
    ).rejects.toThrow(ConflictException);
  });

  it('records a PASS with no match check at all', async () => {
    tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });
    const result = await service.recordSwipe(
      'user-1',
      'target-1',
      SwipeAction.PASS,
    );
    expect(result).toEqual({
      swipeId: 'swipe-1',
      action: SwipeAction.PASS,
      matched: false,
    });
    expect(tx.swipe.findUnique).not.toHaveBeenCalled();
  });

  it('records a LIKE with no reciprocal like as unmatched', async () => {
    tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });
    tx.swipe.findUnique.mockResolvedValue(null);
    const result = await service.recordSwipe(
      'user-1',
      'target-1',
      SwipeAction.LIKE,
    );
    expect(result.matched).toBe(false);
  });

  it('does not match against a reciprocal PASS', async () => {
    tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });
    tx.swipe.findUnique.mockResolvedValue({ action: SwipeAction.PASS });
    const result = await service.recordSwipe(
      'user-1',
      'target-1',
      SwipeAction.LIKE,
    );
    expect(result.matched).toBe(false);
  });

  it('creates a Match on a mutual LIKE, canonically ordered (FR-41, FR-42, FR-43)', async () => {
    tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });
    tx.swipe.findUnique.mockResolvedValue({ action: SwipeAction.LIKE });
    tx.match.create.mockResolvedValue({ id: 'match-1' });

    const result = await service.recordSwipe('bbb', 'aaa', SwipeAction.LIKE);

    expect(tx.match.create).toHaveBeenCalledWith({
      data: {
        userAId: 'aaa',
        userBId: 'bbb',
        source: 'SWIPE',
        matchReasons: [],
        matchMismatches: [],
        explanationGeneratedAt: null,
      }, // 'aaa' < 'bbb'
    });
    expect(result).toEqual({
      swipeId: 'swipe-1',
      action: SwipeAction.LIKE,
      matched: true,
      matchId: 'match-1',
    });
  });

  it('tags the match source SUPER_LIKE when the completing swipe was a super-like (FR-43)', async () => {
    tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });
    tx.swipe.findUnique.mockResolvedValue({ action: SwipeAction.LIKE });
    tx.match.create.mockResolvedValue({ id: 'match-1' });

    await service.recordSwipe('user-1', 'target-1', SwipeAction.SUPER_LIKE);

    expect(tx.match.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'SUPER_LIKE' }),
      }),
    );
  });

  describe('Super Like explanation (FR-124, FR-125)', () => {
    it('generates a structured explanation from the actor and target facts BEFORE the transaction, and stores it on the Swipe row', async () => {
      matchExplanation.generate.mockResolvedValue({
        reasons: ['You both love hiking.'],
        mismatches: [],
      });
      tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });

      await service.recordSwipe('user-1', 'target-1', SwipeAction.SUPER_LIKE);

      expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(matchExplanation.generate).toHaveBeenCalledTimes(1);
      // Called before $transaction, not from inside it — proven by call order.
      expect(
        matchExplanation.generate.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]);
      expect(tx.swipe.create).toHaveBeenCalledWith({
        data: {
          actorId: 'user-1',
          targetId: 'target-1',
          action: SwipeAction.SUPER_LIKE,
          explanationReasons: ['You both love hiking.'],
          explanationMismatches: [],
        },
      });
    });

    it('copies the Super Like explanation directly into Match.matchReasons/matchMismatches when it completes a match — no second generation call', async () => {
      matchExplanation.generate.mockResolvedValue({
        reasons: ['You both love hiking.'],
        mismatches: ['Different cities.'],
      });
      tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });
      tx.swipe.findUnique.mockResolvedValue({ action: SwipeAction.LIKE });
      tx.match.create.mockResolvedValue({ id: 'match-1' });

      await service.recordSwipe('user-1', 'target-1', SwipeAction.SUPER_LIKE);

      expect(tx.match.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: 'SUPER_LIKE',
          matchReasons: ['You both love hiking.'],
          matchMismatches: ['Different cities.'],
          explanationGeneratedAt: expect.any(Date),
        }),
      });
      expect(matchExplanation.generate).toHaveBeenCalledTimes(1); // not twice
    });

    it('never calls the explanation generator for a plain LIKE or PASS', async () => {
      tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });
      await service.recordSwipe('user-1', 'target-1', SwipeAction.LIKE);
      await service.recordSwipe('user-1', 'target-2', SwipeAction.PASS);
      expect(matchExplanation.generate).not.toHaveBeenCalled();
    });

    it('still succeeds with an empty explanation when generation fails open (FR-121)', async () => {
      matchExplanation.generate.mockResolvedValue(null); // MatchExplanationService's own fail-open contract
      tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });

      const result = await service.recordSwipe(
        'user-1',
        'target-1',
        SwipeAction.SUPER_LIKE,
      );

      expect(result.matched).toBe(false);
      expect(tx.swipe.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          explanationReasons: [],
          explanationMismatches: [],
        }),
      });
    });

    it('leaves explanationGeneratedAt null on the Match when generation fails open, so a later read can still retry it (FR-121)', async () => {
      matchExplanation.generate.mockResolvedValue(null);
      tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });
      tx.swipe.findUnique.mockResolvedValue({ action: SwipeAction.LIKE });
      tx.match.create.mockResolvedValue({ id: 'match-1' });

      await service.recordSwipe('user-1', 'target-1', SwipeAction.SUPER_LIKE);

      expect(tx.match.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          matchReasons: [],
          matchMismatches: [],
          explanationGeneratedAt: null,
        }),
      });
    });
  });

  it('does not create a Match between a blocked pair, even on a mutual LIKE (FR-67 defense-in-depth)', async () => {
    tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });
    tx.swipe.findUnique.mockResolvedValue({ action: SwipeAction.LIKE });
    tx.block.findFirst.mockResolvedValue({ id: 'block-1' });

    const result = await service.recordSwipe(
      'user-1',
      'target-1',
      SwipeAction.LIKE,
    );

    expect(result.matched).toBe(false);
    expect(tx.match.create).not.toHaveBeenCalled();
  });

  it('does not create a Match when the target is VERIFIED_ONLY and the actor is unverified (FR-79 defense-in-depth)', async () => {
    tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });
    tx.swipe.findUnique.mockResolvedValue({ action: SwipeAction.LIKE });
    prisma.user.findUnique.mockResolvedValue({
      id: 'target-1',
      livenessStatus: true,
      messagingPermission: 'VERIFIED_ONLY',
    });
    tx.user.findUniqueOrThrow.mockResolvedValue({
      livenessStatus: false,
      messagingPermission: 'EVERYONE',
    });

    const result = await service.recordSwipe(
      'user-1',
      'target-1',
      SwipeAction.LIKE,
    );

    expect(result.matched).toBe(false);
    expect(tx.match.create).not.toHaveBeenCalled();
  });

  it('does not create a Match when the actor is VERIFIED_ONLY and the target is unverified (FR-79, symmetric)', async () => {
    tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });
    tx.swipe.findUnique.mockResolvedValue({ action: SwipeAction.LIKE });
    prisma.user.findUnique.mockResolvedValue({
      id: 'target-1',
      livenessStatus: false,
      messagingPermission: 'EVERYONE',
    });
    tx.user.findUniqueOrThrow.mockResolvedValue({
      livenessStatus: true,
      messagingPermission: 'VERIFIED_ONLY',
    });

    const result = await service.recordSwipe(
      'user-1',
      'target-1',
      SwipeAction.LIKE,
    );

    expect(result.matched).toBe(false);
    expect(tx.match.create).not.toHaveBeenCalled();
  });

  it('recovers from a concurrent duplicate Match insert instead of erroring (FR-41)', async () => {
    tx.swipe.create.mockResolvedValue({ id: 'swipe-1' });
    tx.swipe.findUnique.mockResolvedValue({ action: SwipeAction.LIKE });
    tx.match.create.mockRejectedValue(uniqueViolation());
    tx.match.findUniqueOrThrow.mockResolvedValue({ id: 'existing-match-1' });

    const result = await service.recordSwipe(
      'user-1',
      'target-1',
      SwipeAction.LIKE,
    );

    expect(result).toEqual({
      swipeId: 'swipe-1',
      action: SwipeAction.LIKE,
      matched: true,
      matchId: 'existing-match-1',
    });
  });

  it('lets a transaction-manager failure (e.g. Neon cold-start) propagate untouched — ProblemDetailsFilter handles the 503 globally, not this service', async () => {
    prisma.$transaction.mockRejectedValue(transactionManagerError());

    await expect(
      service.recordSwipe('user-1', 'target-1', SwipeAction.LIKE),
    ).rejects.toMatchObject({
      code: 'P2028',
    });
  });
});
