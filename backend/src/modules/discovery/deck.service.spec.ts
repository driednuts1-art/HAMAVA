import { PrismaService } from '../../prisma/prisma.service';
import type { PreferencesService } from './preferences.service';
import type { StorageProviderInterface } from '../profile/storage/storage-provider.interface';
import type { PresenceService } from '../presence/presence.service';
import { DeckService } from './deck.service';
import {
  decodeRankedCursor,
  encodeRankedCursor,
} from '../../common/pagination/cursor.util';

const VIEWER_DEFAULT_PREFS = {
  minAge: 18,
  maxAge: 100,
  genderPref: [],
  relationshipGoalPref: [],
  verifiedOnly: false,
  activeThisWeekOnly: false,
  newMembersOnly: false,
};

function makeCandidate(
  id: string,
  createdAt: Date,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id,
    displayName: id,
    birthDate: new Date('1995-01-01'),
    city: null,
    bio: null,
    interests: [],
    livenessStatus: true,
    gender: null,
    datingIntent: null,
    createdAt,
    photos: [],
    showLastActiveStatus: true,
    lastOnlineAt: null,
    ...overrides,
  };
}

describe('DeckService — boost tier (FR-127, FR-128)', () => {
  let service: DeckService;
  let prisma: {
    user: { findUniqueOrThrow: jest.Mock; findMany: jest.Mock };
    boost: { findMany: jest.Mock };
  };
  let preferences: jest.Mocked<PreferencesService>;
  let storage: jest.Mocked<StorageProviderInterface>;
  let presenceService: {
    getOnlineMap: jest.Mock;
    buildPresenceField: jest.Mock;
  };

  const viewer = {
    livenessStatus: true,
    birthDate: new Date('1995-01-01'), // age 31 as of 2026
    gender: 'MALE',
    datingIntent: 'SERIOUS',
    showLastActiveStatus: true,
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01'));
    prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(viewer),
        findMany: jest.fn(),
      },
      boost: { findMany: jest.fn().mockResolvedValue([]) },
    };
    preferences = {
      getEffective: jest.fn().mockResolvedValue(VIEWER_DEFAULT_PREFS),
      update: jest.fn(),
    } as unknown as jest.Mocked<PreferencesService>;
    storage = {
      getUrl: jest.fn().mockResolvedValue('https://example/url'),
    } as unknown as jest.Mocked<StorageProviderInterface>;
    presenceService = {
      getOnlineMap: jest.fn().mockResolvedValue(new Map()),
      buildPresenceField: jest.fn().mockReturnValue(null),
    };

    service = new DeckService(
      prisma as unknown as PrismaService,
      preferences,
      storage,
      presenceService as unknown as PresenceService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('preserves plain (createdAt, id) order when nobody is boosted (regression)', async () => {
    prisma.user.findMany.mockResolvedValue([
      makeCandidate('a', new Date('2026-01-01T10:00:00Z')),
      makeCandidate('b', new Date('2026-01-01T11:00:00Z')),
    ]);

    const result = await service.getDeck('viewer-1', { limit: 20 });

    expect(result.candidates.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('promotes a boosted candidate the viewer reciprocally satisfies (FR-127, positive case)', async () => {
    prisma.user.findMany.mockResolvedValue([
      makeCandidate('older-unboosted', new Date('2026-01-01T09:00:00Z')),
      makeCandidate('boosted', new Date('2026-01-01T11:00:00Z')),
    ]);
    prisma.boost.findMany.mockResolvedValue([{ userId: 'boosted' }]);
    // The booster's own preferences the viewer must satisfy — viewer is age
    // 31, MALE, SERIOUS, which fits this.
    preferences.getEffective.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'boosted'
          ? { ...VIEWER_DEFAULT_PREFS, minAge: 25, maxAge: 40 }
          : VIEWER_DEFAULT_PREFS,
      ),
    );

    const result = await service.getDeck('viewer-1', { limit: 20 });

    // Boosted candidate first, even though it's chronologically newer.
    expect(result.candidates.map((c) => c.id)).toEqual([
      'boosted',
      'older-unboosted',
    ]);
  });

  it('does NOT promote a boosted candidate whose own preferences the viewer fails to satisfy (FR-127, negative case)', async () => {
    prisma.user.findMany.mockResolvedValue([
      makeCandidate('older', new Date('2026-01-01T09:00:00Z')),
      makeCandidate('boosted-but-excluded', new Date('2026-01-01T11:00:00Z')),
    ]);
    prisma.boost.findMany.mockResolvedValue([
      { userId: 'boosted-but-excluded' },
    ]);
    // The booster only wants ages 50-60 — the 31-year-old viewer doesn't qualify.
    preferences.getEffective.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'boosted-but-excluded'
          ? { ...VIEWER_DEFAULT_PREFS, minAge: 50, maxAge: 60 }
          : VIEWER_DEFAULT_PREFS,
      ),
    );

    const result = await service.getDeck('viewer-1', { limit: 20 });

    // Plain (createdAt, id) order — the boost has no effect at all.
    expect(result.candidates.map((c) => c.id)).toEqual([
      'older',
      'boosted-but-excluded',
    ]);
  });

  it('does not promote a boosted candidate the viewer fails on genderPref, even if age matches', async () => {
    prisma.user.findMany.mockResolvedValue([
      makeCandidate('older', new Date('2026-01-01T09:00:00Z')),
      makeCandidate('boosted-wrong-gender', new Date('2026-01-01T11:00:00Z')),
    ]);
    prisma.boost.findMany.mockResolvedValue([
      { userId: 'boosted-wrong-gender' },
    ]);
    preferences.getEffective.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'boosted-wrong-gender'
          ? { ...VIEWER_DEFAULT_PREFS, genderPref: ['FEMALE'] }
          : VIEWER_DEFAULT_PREFS,
      ),
    );

    const result = await service.getDeck('viewer-1', { limit: 20 });

    expect(result.candidates.map((c) => c.id)).toEqual([
      'older',
      'boosted-wrong-gender',
    ]);
  });

  it('paginates correctly across the boosted/non-boosted tier boundary — no dupes, no skips', async () => {
    prisma.user.findMany.mockResolvedValue([
      makeCandidate('normal-1', new Date('2026-01-01T09:00:00Z')),
      makeCandidate('normal-2', new Date('2026-01-01T10:00:00Z')),
      makeCandidate('boosted-1', new Date('2026-01-01T11:00:00Z')),
    ]);
    prisma.boost.findMany.mockResolvedValue([{ userId: 'boosted-1' }]);
    preferences.getEffective.mockResolvedValue(VIEWER_DEFAULT_PREFS);

    const page1 = await service.getDeck('viewer-1', { limit: 1 });
    expect(page1.candidates.map((c) => c.id)).toEqual(['boosted-1']);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await service.getDeck('viewer-1', {
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.candidates.map((c) => c.id)).toEqual(['normal-1', 'normal-2']);
  });

  it('returns an empty result with no crash when the hard-filtered pool is empty', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    const result = await service.getDeck('viewer-1', { limit: 20 });
    expect(result).toEqual({ candidates: [], nextCursor: null });
    expect(prisma.boost.findMany).not.toHaveBeenCalled();
  });

  // Feature 27 (FR-489): no existing test in this file inspects the actual
  // `where` object passed to prisma.user.findMany() for any filter
  // (activeThisWeekOnly included) — only the in-memory tiering/pagination
  // behavior on top of a pre-mocked result. This is a real, new, structural
  // regression guard: it proves newMembersOnly is composed into the *same*
  // where object buildSafetyExclusionWhere already populates (id/not,
  // profileCompletedAt, swipesReceived, blocksMade/Received), not a second,
  // parallel query that could silently drift and forget those exclusions.
  it('composes newMembersOnly into the same where object as the safety exclusions, never a second parallel query (FR-489)', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    preferences.getEffective.mockResolvedValue({
      ...VIEWER_DEFAULT_PREFS,
      newMembersOnly: true,
    });

    await service.getDeck('viewer-1', { limit: 20 });

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    const calledWhere = prisma.user.findMany.mock.calls[0][0].where;
    // The real safety-exclusion fields (buildSafetyExclusionWhere) are
    // present on the exact same where object as the new filter.
    expect(calledWhere.id).toEqual({ not: 'viewer-1' });
    expect(calledWhere.profileCompletedAt).toEqual({ not: null });
    expect(calledWhere.swipesReceived).toEqual({
      none: { actorId: 'viewer-1' },
    });
    // The new filter itself: createdAt within the last 7 days.
    expect(calledWhere.createdAt.gte).toBeInstanceOf(Date);
    const daysAgo =
      (Date.now() - (calledWhere.createdAt.gte as Date).getTime()) /
      (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeCloseTo(7, 1);
  });

  it('omits the createdAt filter entirely when newMembersOnly is off (default)', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await service.getDeck('viewer-1', { limit: 20 });

    const calledWhere = prisma.user.findMany.mock.calls[0][0].where;
    expect(calledWhere.createdAt).toBeUndefined();
  });

  it('marks a candidate created within the last 7 days as isNewMember, and an older one as not (FR-490)', async () => {
    prisma.user.findMany.mockResolvedValue([
      makeCandidate('brand-new', new Date()), // created "now"
      makeCandidate('old-timer', new Date('2020-01-01')),
    ]);

    const result = await service.getDeck('viewer-1', { limit: 20 });

    expect(
      result.candidates.find((c) => c.id === 'brand-new')!.isNewMember,
    ).toBe(true);
    expect(
      result.candidates.find((c) => c.id === 'old-timer')!.isNewMember,
    ).toBe(false);
  });

  it('attaches the presence field via PresenceService, gated by the symmetric privacy rule (FR-485/FR-486)', async () => {
    prisma.user.findMany.mockResolvedValue([
      makeCandidate('a', new Date('2026-01-01T10:00:00Z'), {
        showLastActiveStatus: true,
        lastOnlineAt: new Date('2026-01-01T09:00:00Z'),
      }),
    ]);
    presenceService.getOnlineMap.mockResolvedValue(new Map([['a', true]]));
    presenceService.buildPresenceField.mockReturnValue({
      online: true,
      lastOnlineAt: new Date('2026-01-01T09:00:00Z'),
    });

    const result = await service.getDeck('viewer-1', { limit: 20 });

    expect(presenceService.getOnlineMap).toHaveBeenCalledWith(['a']);
    expect(presenceService.buildPresenceField).toHaveBeenCalledWith(
      true, // viewer.showLastActiveStatus
      true, // candidate's own showLastActiveStatus
      true, // online, from the batched map
      new Date('2026-01-01T09:00:00Z'),
    );
    expect(result.candidates[0].presence).toEqual({
      online: true,
      lastOnlineAt: new Date('2026-01-01T09:00:00Z'),
    });
  });

  it('round-trips a boost-tier cursor through the shared ranked-cursor utility (sanity check on reuse, not a new format)', () => {
    const encoded = encodeRankedCursor(
      0,
      new Date('2026-01-01T10:00:00Z'),
      'id-1',
    );
    const decoded = decodeRankedCursor(encoded);
    expect(decoded.distance).toBe(0);
    expect(decoded.id).toBe('id-1');
  });
});
