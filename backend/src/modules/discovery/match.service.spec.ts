import { PrismaService } from '../../prisma/prisma.service';
import type { MatchExplanationService } from './match-explanation/match-explanation.service';
import type { PresenceService } from '../presence/presence.service';
import { MatchService } from './match.service';

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-a',
    displayName: 'A',
    birthDate: null,
    city: null,
    bio: null,
    interests: [],
    datingIntent: null,
    livenessStatus: true,
    photos: [],
    showLastActiveStatus: true,
    lastOnlineAt: null,
    ...overrides,
  };
}

describe('MatchService (FR-45, FR-122, FR-123, extended by Feature 21 FR-302..FR-306)', () => {
  let service: MatchService;
  let prisma: {
    match: { findMany: jest.Mock; update: jest.Mock };
    user: { findUniqueOrThrow: jest.Mock };
  };
  let matchExplanation: { generate: jest.Mock };
  let presenceService: {
    getOnlineMap: jest.Mock;
    buildPresenceField: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      match: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ showLastActiveStatus: true }),
      },
    };
    matchExplanation = { generate: jest.fn() };
    presenceService = {
      getOnlineMap: jest.fn().mockResolvedValue(new Map()),
      buildPresenceField: jest.fn().mockReturnValue(null),
    };
    service = new MatchService(
      prisma as unknown as PrismaService,
      matchExplanation as unknown as MatchExplanationService,
      presenceService as unknown as PresenceService,
    );
  });

  it('returns a match with an existing explanation unchanged, with no generation call', async () => {
    prisma.match.findMany.mockResolvedValue([
      {
        id: 'match-1',
        userAId: 'me',
        userBId: 'other-1',
        source: 'SWIPE',
        matchReasons: ['Already generated.'],
        matchMismatches: [],
        explanationGeneratedAt: new Date('2026-01-01'),
        createdAt: new Date('2026-01-01'),
        userA: makeUser({ id: 'me' }),
        userB: makeUser({ id: 'other-1' }),
      },
    ]);

    const result = await service.listMatches('me');

    expect(result[0].matchReasons).toEqual(['Already generated.']);
    expect(matchExplanation.generate).not.toHaveBeenCalled();
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it('lazily generates and persists reasons/mismatches for a match with none yet (FR-122)', async () => {
    prisma.match.findMany.mockResolvedValue([
      {
        id: 'match-1',
        userAId: 'me',
        userBId: 'other-1',
        source: 'SWIPE',
        matchReasons: [],
        matchMismatches: [],
        explanationGeneratedAt: null,
        createdAt: new Date('2026-01-01'),
        userA: makeUser({ id: 'me' }),
        userB: makeUser({ id: 'other-1' }),
      },
    ]);
    matchExplanation.generate.mockResolvedValue({
      reasons: ['You both love hiking.'],
      mismatches: ['Different cities.'],
    });

    const result = await service.listMatches('me');

    expect(matchExplanation.generate).toHaveBeenCalledTimes(1);
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: expect.objectContaining({
        matchReasons: ['You both love hiking.'],
        matchMismatches: ['Different cities.'],
        explanationGeneratedAt: expect.any(Date),
      }),
    });
    expect(result[0].matchReasons).toEqual(['You both love hiking.']);
    expect(result[0].matchMismatches).toEqual(['Different cities.']);
    expect(result[0].explanationGeneratedAt).toBeInstanceOf(Date);
  });

  it('treats a real, honestly-generated empty mismatches array as "already generated" — never regenerates it (FR-304)', async () => {
    prisma.match.findMany.mockResolvedValue([
      {
        id: 'match-1',
        userAId: 'me',
        userBId: 'other-1',
        source: 'SWIPE',
        matchReasons: ['Strongly aligned on everything stated.'],
        matchMismatches: [],
        explanationGeneratedAt: new Date('2026-01-01'),
        createdAt: new Date('2026-01-01'),
        userA: makeUser({ id: 'me' }),
        userB: makeUser({ id: 'other-1' }),
      },
    ]);

    const result = await service.listMatches('me');

    expect(matchExplanation.generate).not.toHaveBeenCalled();
    expect(result[0].matchMismatches).toEqual([]);
  });

  it('processes multiple un-explained matches sequentially, not in parallel (FR-122)', async () => {
    prisma.match.findMany.mockResolvedValue([
      {
        id: 'match-1',
        userAId: 'me',
        userBId: 'other-1',
        source: 'SWIPE',
        matchReasons: [],
        matchMismatches: [],
        explanationGeneratedAt: null,
        createdAt: new Date('2026-01-02'),
        userA: makeUser({ id: 'me' }),
        userB: makeUser({ id: 'other-1' }),
      },
      {
        id: 'match-2',
        userAId: 'me',
        userBId: 'other-2',
        source: 'SWIPE',
        matchReasons: [],
        matchMismatches: [],
        explanationGeneratedAt: null,
        createdAt: new Date('2026-01-01'),
        userA: makeUser({ id: 'me' }),
        userB: makeUser({ id: 'other-2' }),
      },
    ]);

    const callOrder: string[] = [];
    matchExplanation.generate.mockImplementation(
      async (_a: unknown, b: { id?: string }) => {
        callOrder.push('start');
        await new Promise((r) => setTimeout(r, 1));
        callOrder.push('end');
        return {
          reasons: [`explanation for ${JSON.stringify(b)}`],
          mismatches: [],
        };
      },
    );

    await service.listMatches('me');

    // Sequential: each call's 'start'/'end' pair completes before the next
    // 'start' — a parallel (Promise.all) implementation would interleave
    // as [start, start, end, end] instead.
    expect(callOrder).toEqual(['start', 'end', 'start', 'end']);
    expect(prisma.match.update).toHaveBeenCalledTimes(2);
  });

  it('leaves explanationGeneratedAt null and never calls update when generation fails open (FR-121)', async () => {
    prisma.match.findMany.mockResolvedValue([
      {
        id: 'match-1',
        userAId: 'me',
        userBId: 'other-1',
        source: 'SWIPE',
        matchReasons: [],
        matchMismatches: [],
        explanationGeneratedAt: null,
        createdAt: new Date('2026-01-01'),
        userA: makeUser({ id: 'me' }),
        userB: makeUser({ id: 'other-1' }),
      },
    ]);
    matchExplanation.generate.mockResolvedValue(null); // MatchExplanationService's own fail-open contract

    const result = await service.listMatches('me');

    expect(result[0].explanationGeneratedAt).toBeNull();
    expect(result[0].matchReasons).toEqual([]);
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it('surfaces matchSource on the response (FR-125)', async () => {
    prisma.match.findMany.mockResolvedValue([
      {
        id: 'match-1',
        userAId: 'me',
        userBId: 'other-1',
        source: 'SUPER_LIKE',
        matchReasons: ['Generated at Super Like time.'],
        matchMismatches: [],
        explanationGeneratedAt: new Date('2026-01-01'),
        createdAt: new Date('2026-01-01'),
        userA: makeUser({ id: 'me' }),
        userB: makeUser({ id: 'other-1' }),
      },
    ]);

    const result = await service.listMatches('me');

    expect(result[0].matchSource).toBe('SUPER_LIKE');
  });
});
