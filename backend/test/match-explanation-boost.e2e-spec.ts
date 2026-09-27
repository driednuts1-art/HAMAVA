import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { OTP_PROVIDER } from '../src/modules/auth/otp/otp-provider.interface';
import { MATCH_EXPLANATION_PROVIDER } from '../src/modules/discovery/match-explanation/match-explanation-provider.interface';
import type { MatchExplanationProviderInterface } from '../src/modules/discovery/match-explanation/match-explanation-provider.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { rejectVendorUnavailable } from './helpers/vendor-failure';
import { uniquePhone } from './helpers/unique-phone';
import { fetchFullDeck } from './helpers/paginate-to-exhaustion';

interface VerifyResponseBody {
  accessToken: string;
  user: { id: string };
}

interface SwipeResponseBody {
  swipeId: string;
  matched: boolean;
  matchId?: string;
}

interface MatchSummary {
  matchId: string;
  matchSource: 'SWIPE' | 'SUPER_LIKE';
  matchReasons: string[];
  matchMismatches: string[];
  explanationGeneratedAt: string | null;
  user: { id: string };
}

interface BoostStatus {
  active: boolean;
  endsAt: string | null;
}

/**
 * End-to-end test for Feature 10 (docs/requirements.md) — Super Like
 * explanation, "Why You Two?", and Smart Boost — run against real
 * infrastructure: the real OpenAI generation + grounding-check calls, a
 * real Postgres database, and real HTTP auth/profile/swipe flows.
 */
describe('Super Like explanation, Why You Two, Smart Boost (e2e)', () => {
  let app: INestApplication<App>;
  let capturedCode: string;
  const createdUserIds: string[] = [];

  async function getAccessToken(
    phone: string,
  ): Promise<{ token: string; userId: string }> {
    await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone })
      .expect(202);
    const verifyRes = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ phone, code: capturedCode })
      .expect(200);
    const body = verifyRes.body as VerifyResponseBody;
    createdUserIds.push(body.user.id);
    return { token: body.accessToken, userId: body.user.id };
  }

  async function buildCandidate(
    token: string,
    opts: {
      displayName: string;
      birthYear: number;
      gender: string;
      datingIntent: string;
      bio?: string;
    },
  ): Promise<void> {
    const auth = `Bearer ${token}`;
    await request(app.getHttpServer())
      .patch('/v1/profile')
      .set('Authorization', auth)
      .send({
        displayName: opts.displayName,
        birthDate: `${opts.birthYear}-01-01`,
        gender: opts.gender,
        datingIntent: opts.datingIntent,
        ...(opts.bio ? { bio: opts.bio } : {}),
        // Feature 24 (FR-435): profile completeness now also requires 2
        // real prompt answers — without this, these candidates never get a
        // real profileCompletedAt, and FR-37's exclusion then hides every
        // one of them from every real candidate-facing query this suite
        // exercises.
        promptAnswers: [
          { promptId: 'best-night', answer: 'A quiet night with good music.' },
          { promptId: 'weird-fact', answer: "I can solve a Rubik's cube." },
        ],
      })
      .expect(200);

    const jpeg = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .jpeg()
      .toBuffer();
    await request(app.getHttpServer())
      .post('/v1/profile/photos')
      .set('Authorization', auth)
      .attach('photo', jpeg, { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/consent/biometric')
      .set('Authorization', auth)
      .send({ policyVersion: 'v1' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/v1/verification/liveness/session')
      .set('Authorization', auth)
      .expect(201);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OTP_PROVIDER)
      .useValue({
        sendOtp: (_phone: string, code: string) => {
          capturedCode = code;
          return Promise.resolve();
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await app
        .get(PrismaService)
        .user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await app.close();
  });

  it('a real Super Like generates a real, non-empty explanation stored on the Swipe row (FR-124)', async () => {
    // FR-119's grounding check is a real, independent LLM call sitting
    // between generation and persistence, and generation is non-
    // deterministic — the same two profiles can produce a safely-phrased
    // explanation on one call and an over-claiming one (correctly
    // discarded) on the next. A single rejected attempt is therefore an
    // expected outcome, not proof the FR-124 wiring is broken (see
    // docs/architecture.md's Feature 10 section for the real observed case
    // that motivated this retry loop). Each attempt uses a fresh pair so a
    // discarded explanation doesn't block re-swiping the same pair.
    let explanation: string[] | null = null;
    for (let attempt = 0; attempt < 3 && explanation === null; attempt++) {
      const a = await getAccessToken(uniquePhone());
      const b = await getAccessToken(uniquePhone());
      await buildCandidate(a.token, {
        displayName: 'E2E-SL-A',
        birthYear: 1994,
        gender: 'MALE',
        datingIntent: 'SERIOUS',
        bio: 'اهل کوهنوردی و کتاب هستم',
      });
      await buildCandidate(b.token, {
        displayName: 'E2E-SL-B',
        birthYear: 1993,
        gender: 'FEMALE',
        datingIntent: 'SERIOUS',
        bio: 'عاشق طبیعت‌گردی و رمان‌خوانی',
      });

      await request(app.getHttpServer())
        .post('/v1/discovery/swipes')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ targetUserId: b.userId, action: 'SUPER_LIKE' })
        .expect(201);

      const swipe = await app.get(PrismaService).swipe.findUniqueOrThrow({
        where: { actorId_targetId: { actorId: a.userId, targetId: b.userId } },
      });
      explanation =
        swipe.explanationReasons.length > 0 ? swipe.explanationReasons : null;
    }

    // If three independent real generations all get rejected by the
    // grounding check, that's no longer "an expected occasional rejection"
    // — it would suggest a real prompt-calibration regression worth
    // investigating, so this still fails loudly rather than swallowing it.
    expect(explanation).toBeTruthy();
    expect((explanation as string[]).length).toBeGreaterThan(0);
  }, 120000);

  it('when a Super Like completes a match, whyYouTwo and matchSource surface via GET /v1/discovery/matches with no second generation call (FR-125)', async () => {
    const a = await getAccessToken(uniquePhone());
    const b = await getAccessToken(uniquePhone());
    await buildCandidate(a.token, {
      displayName: 'E2E-SLM-A',
      birthYear: 1994,
      gender: 'MALE',
      datingIntent: 'SERIOUS',
      bio: 'اهل کوهنوردی',
    });
    await buildCandidate(b.token, {
      displayName: 'E2E-SLM-B',
      birthYear: 1993,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      bio: 'عاشق طبیعت‌گردی',
    });

    // FR-43 (Feature 3, unchanged): Match.source is determined by the
    // COMPLETING (second) swipe's action — so B's plain LIKE has to come
    // first, and A's SUPER_LIKE has to be the one that completes the match,
    // for source to actually land as SUPER_LIKE.
    await request(app.getHttpServer())
      .post('/v1/discovery/swipes')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ targetUserId: a.userId, action: 'LIKE' })
      .expect(201);
    const matchRes = await request(app.getHttpServer())
      .post('/v1/discovery/swipes')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ targetUserId: b.userId, action: 'SUPER_LIKE' })
      .expect(201);
    const swipeResult = matchRes.body as SwipeResponseBody;
    expect(swipeResult.matched).toBe(true);

    const swipe = await app.get(PrismaService).swipe.findUniqueOrThrow({
      where: { actorId_targetId: { actorId: a.userId, targetId: b.userId } },
    });

    const matches = (
      await request(app.getHttpServer())
        .get('/v1/discovery/matches')
        .set('Authorization', `Bearer ${a.token}`)
        .expect(200)
    ).body as MatchSummary[];
    const match = matches.find((m) => m.matchId === swipeResult.matchId)!;

    expect(match.matchSource).toBe('SUPER_LIKE');
    // Exact array equality is the real evidence no second generation call
    // happened — a fresh LLM call would very unlikely reproduce the same
    // text verbatim.
    expect(match.matchReasons).toEqual(swipe.explanationReasons);
    expect(match.matchMismatches).toEqual(swipe.explanationMismatches);
  }, 60000);

  it('a match from two plain LIKEs has no explanation generated immediately, then a real persisted value after the first read (FR-122)', async () => {
    // Same non-determinism as the Super Like test above: FR-119's grounding
    // check can legitimately reject any individual real generation, so a
    // fresh pair is retried a bounded number of times rather than treating
    // one rejection as a wiring failure.
    let matchId = '';
    let aToken = '';
    let firstExplanation: string[] | null = null;
    for (let attempt = 0; attempt < 3 && firstExplanation === null; attempt++) {
      const a = await getAccessToken(uniquePhone());
      const b = await getAccessToken(uniquePhone());
      aToken = a.token;
      await buildCandidate(a.token, {
        displayName: 'E2E-WYT-A',
        birthYear: 1994,
        gender: 'MALE',
        datingIntent: 'SERIOUS',
        bio: 'اهل موسیقی و سفر',
      });
      await buildCandidate(b.token, {
        displayName: 'E2E-WYT-B',
        birthYear: 1993,
        gender: 'FEMALE',
        datingIntent: 'SERIOUS',
        bio: 'عاشق موسیقی زنده',
      });

      await request(app.getHttpServer())
        .post('/v1/discovery/swipes')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ targetUserId: b.userId, action: 'LIKE' })
        .expect(201);
      const matchRes = await request(app.getHttpServer())
        .post('/v1/discovery/swipes')
        .set('Authorization', `Bearer ${b.token}`)
        .send({ targetUserId: a.userId, action: 'LIKE' })
        .expect(201);
      const newMatchId = (matchRes.body as SwipeResponseBody).matchId;
      expect(newMatchId).toBeTruthy();
      matchId = newMatchId as string;

      const immediate = await app
        .get(PrismaService)
        .match.findUniqueOrThrow({ where: { id: matchId } });
      expect(immediate.explanationGeneratedAt).toBeNull();
      expect(immediate.matchReasons).toEqual([]);

      const firstRead = (
        await request(app.getHttpServer())
          .get('/v1/discovery/matches')
          .set('Authorization', `Bearer ${a.token}`)
          .expect(200)
      ).body as MatchSummary[];
      const firstReadReasons = firstRead.find(
        (m) => m.matchId === matchId,
      )!.matchReasons;
      firstExplanation = firstReadReasons.length > 0 ? firstReadReasons : null;
    }

    // Same "three real rejections in a row is a real regression signal" logic
    // as the Super Like test above.
    expect(firstExplanation).toBeTruthy();

    const secondRead = (
      await request(app.getHttpServer())
        .get('/v1/discovery/matches')
        .set('Authorization', `Bearer ${aToken}`)
        .expect(200)
    ).body as MatchSummary[];
    expect(secondRead.find((m) => m.matchId === matchId)!.matchReasons).toEqual(
      firstExplanation,
    ); // persisted, not regenerated
  }, 150000);

  it('a match between very sparse profiles (name + city only, no bio) never fabricates a specific fact (FR-119, dedicated low-information test)', async () => {
    const a = await getAccessToken(uniquePhone());
    const b = await getAccessToken(uniquePhone());
    // Only displayName/birthDate/photo/verification — no bio, no interests.
    await buildCandidate(a.token, {
      displayName: 'Reza',
      birthYear: 1994,
      gender: 'MALE',
      datingIntent: 'SERIOUS',
    });
    await buildCandidate(b.token, {
      displayName: 'Sara',
      birthYear: 1993,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
    });
    await request(app.getHttpServer())
      .patch('/v1/profile')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ city: 'Shiraz' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/v1/discovery/swipes')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ targetUserId: b.userId, action: 'LIKE' })
      .expect(201);
    const matchRes = await request(app.getHttpServer())
      .post('/v1/discovery/swipes')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ targetUserId: a.userId, action: 'LIKE' })
      .expect(201);
    const matchId = (matchRes.body as SwipeResponseBody).matchId;

    const matches = (
      await request(app.getHttpServer())
        .get('/v1/discovery/matches')
        .set('Authorization', `Bearer ${a.token}`)
        .expect(200)
    ).body as MatchSummary[];
    const found = matches.find((m) => m.matchId === matchId)!;

    // Never null-safety-fails the test either way (a genuinely empty result
    // is an acceptable outcome per FR-118..FR-121) — the real assertion is
    // that whatever WAS produced never invents a specific, checkable detail
    // that provably isn't in either profile (no bio/interests exist here).
    // The real explanation is always generated in English (fixed, not
    // user-language-dependent — this is app-generated UI content, not a
    // live conversation with the user), so the fabrication check below
    // looks for English words, not the bios' own languages.
    for (const claim of [...found.matchReasons, ...found.matchMismatches]) {
      expect(claim).not.toMatch(/books|music|sports|travel|hiking/i);
    }
  }, 60000);

  it("FR-119's grounding check actually discriminates: a deliberately fabricated REASON is flagged, not rubber-stamped", async () => {
    const provider = app.get<MatchExplanationProviderInterface>(
      MATCH_EXPLANATION_PROVIDER,
    );
    const personA = {
      displayName: 'A',
      age: 30,
      city: 'Tehran',
      bio: 'I love hiking',
      interests: ['hiking'],
      datingIntent: 'SERIOUS' as const,
    };
    const personB = {
      displayName: 'B',
      age: 28,
      city: 'Tehran',
      bio: 'Software engineer',
      interests: [],
      datingIntent: 'SERIOUS' as const,
    };
    const fabricated = {
      reasons: [
        'You both grew up in the same small village and share a love of scuba diving.',
      ],
      mismatches: [],
    };

    const result = await provider.checkGrounded(personA, personB, fabricated);

    expect(result.grounded).toBe(false);
    expect(result.unsupportedClaim).toBeTruthy();
  }, 30000);

  it("FR-119's grounding check discriminates the same way for a deliberately fabricated MISMATCH — not just reasons (FR-302)", async () => {
    const provider = app.get<MatchExplanationProviderInterface>(
      MATCH_EXPLANATION_PROVIDER,
    );
    const personA = {
      displayName: 'A',
      age: 30,
      city: 'Tehran',
      bio: 'I love hiking',
      interests: ['hiking'],
      datingIntent: 'SERIOUS' as const,
    };
    const personB = {
      displayName: 'B',
      age: 28,
      city: 'Tehran',
      bio: 'Software engineer',
      interests: [],
      datingIntent: 'SERIOUS' as const,
    };
    const fabricated = {
      reasons: ['Both are looking for something serious.'],
      mismatches: [
        'A previously had a falling-out with someone from the same hometown as B.',
      ],
    };

    const result = await provider.checkGrounded(personA, personB, fabricated);

    expect(result.grounded).toBe(false);
    expect(result.unsupportedClaim).toBeTruthy();
  }, 30000);

  it('a Super Like still succeeds with a null explanation when the vendor fails; the match read also stays 200 with null (fail-open, FR-121)', async () => {
    const failingModule: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OTP_PROVIDER)
      .useValue({
        sendOtp: (_phone: string, code: string) => {
          capturedCode = code;
          return Promise.resolve();
        },
      })
      .overrideProvider(MATCH_EXPLANATION_PROVIDER)
      .useValue({
        // MatchExplanationService.generate() catches any thrown error type
        // here (no instanceof check, unlike FR-116's withDeckFallbackHint),
        // so this doesn't change behavior either way — but using the real
        // ServiceUnavailableException shape (test/helpers/vendor-failure.ts)
        // keeps every vendor-failure test in this codebase consistent with
        // what OpenAiMatchExplanationProvider actually throws, rather than
        // relying on this call site happening to not care about the type.
        generate: () => rejectVendorUnavailable(),
        checkGrounded: () => rejectVendorUnavailable(),
      })
      .compile();

    const failingApp: INestApplication<App> =
      failingModule.createNestApplication();
    failingApp.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    failingApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    failingApp.useGlobalFilters(new ProblemDetailsFilter());
    await failingApp.init();

    try {
      async function signUpAndBuild(phone: string, name: string) {
        await request(failingApp.getHttpServer())
          .post('/v1/auth/otp/request')
          .send({ phone })
          .expect(202);
        const verifyRes = await request(failingApp.getHttpServer())
          .post('/v1/auth/otp/verify')
          .send({ phone, code: capturedCode })
          .expect(200);
        const body = verifyRes.body as VerifyResponseBody;
        createdUserIds.push(body.user.id);
        const auth = `Bearer ${body.accessToken}`;
        await request(failingApp.getHttpServer())
          .patch('/v1/profile')
          .set('Authorization', auth)
          .send({
            displayName: name,
            birthDate: '1994-01-01',
            // Feature 24 (FR-435): see the other buildCompleteProfile note
            // above — a real candidate must actually complete to survive
            // FR-37's exclusion.
            promptAnswers: [
              {
                promptId: 'best-night',
                answer: 'A quiet night with good music.',
              },
              { promptId: 'weird-fact', answer: "I can solve a Rubik's cube." },
            ],
          })
          .expect(200);
        const jpeg = await sharp({
          create: {
            width: 40,
            height: 40,
            channels: 3,
            background: { r: 1, g: 2, b: 3 },
          },
        })
          .jpeg()
          .toBuffer();
        await request(failingApp.getHttpServer())
          .post('/v1/profile/photos')
          .set('Authorization', auth)
          .attach('photo', jpeg, {
            filename: 'p.jpg',
            contentType: 'image/jpeg',
          })
          .expect(201);
        await request(failingApp.getHttpServer())
          .post('/v1/consent/biometric')
          .set('Authorization', auth)
          .send({ policyVersion: 'v1' })
          .expect(201);
        await request(failingApp.getHttpServer())
          .post('/v1/verification/liveness/session')
          .set('Authorization', auth)
          .expect(201);
        return { token: body.accessToken, userId: body.user.id };
      }

      const a = await signUpAndBuild(uniquePhone(), 'FailA');
      const b = await signUpAndBuild(uniquePhone(), 'FailB');

      const swipeRes = await request(failingApp.getHttpServer())
        .post('/v1/discovery/swipes')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ targetUserId: b.userId, action: 'SUPER_LIKE' })
        .expect(201); // still succeeds despite the vendor failure

      expect((swipeRes.body as SwipeResponseBody).matched).toBe(false);

      const matchRes = await request(failingApp.getHttpServer())
        .post('/v1/discovery/swipes')
        .set('Authorization', `Bearer ${b.token}`)
        .send({ targetUserId: a.userId, action: 'LIKE' })
        .expect(201);
      const matchId = (matchRes.body as SwipeResponseBody).matchId;

      const matches = (
        await request(failingApp.getHttpServer())
          .get('/v1/discovery/matches')
          .set('Authorization', `Bearer ${a.token}`)
          .expect(200)
      ) // never a 500
      .body as MatchSummary[];
      const found = matches.find((m) => m.matchId === matchId)!;
      expect(found.explanationGeneratedAt).toBeNull();
      expect(found.matchReasons).toEqual([]);
      expect(found.matchMismatches).toEqual([]);
    } finally {
      await failingApp.close();
    }
  }, 60000);

  it('Smart Boost: rejects a second activation with 409 while one is active, and GET reflects real remaining time (FR-126, FR-127)', async () => {
    const user = await getAccessToken(uniquePhone());

    const before = (
      await request(app.getHttpServer())
        .get('/v1/discovery/boost')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200)
    ).body as BoostStatus;
    expect(before.active).toBe(false);

    const activated = (
      await request(app.getHttpServer())
        .post('/v1/discovery/boost')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(201)
    ).body as BoostStatus;
    expect(activated.active).toBe(true);
    expect(activated.endsAt).toBeTruthy();

    await request(app.getHttpServer())
      .post('/v1/discovery/boost')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(409);

    const status = (
      await request(app.getHttpServer())
        .get('/v1/discovery/boost')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200)
    ).body as BoostStatus;
    expect(status.active).toBe(true);
  });

  it('promotes a boosted candidate the viewer reciprocally satisfies ahead of an earlier non-boosted one (FR-127, positive case)', async () => {
    const viewer = await getAccessToken(uniquePhone());
    const earlyPlain = await getAccessToken(uniquePhone());
    const boosted = await getAccessToken(uniquePhone());

    await buildCandidate(viewer.token, {
      displayName: 'E2E-Boost-Viewer',
      birthYear: 1994,
      gender: 'MALE',
      datingIntent: 'SERIOUS',
    });
    await buildCandidate(earlyPlain.token, {
      displayName: 'E2E-Boost-Early',
      birthYear: 1994,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
    });
    await buildCandidate(boosted.token, {
      displayName: 'E2E-Boost-Boosted',
      birthYear: 1994,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
    });

    await request(app.getHttpServer())
      .post('/v1/discovery/boost')
      .set('Authorization', `Bearer ${boosted.token}`)
      .expect(201);

    const candidates = await fetchFullDeck(app.getHttpServer(), viewer.token);
    const ids = candidates.map((c) => c.id);
    const boostedIndex = ids.indexOf(boosted.userId);
    const earlyIndex = ids.indexOf(earlyPlain.userId);

    expect(boostedIndex).toBeGreaterThanOrEqual(0);
    expect(earlyIndex).toBeGreaterThanOrEqual(0);
    expect(boostedIndex).toBeLessThan(earlyIndex); // boosted appears first
  }, 60000);

  it('does NOT promote a boosted candidate whose own DiscoveryPreferences the viewer fails to satisfy (FR-127, negative case)', async () => {
    const viewer = await getAccessToken(uniquePhone());
    const earlyPlain = await getAccessToken(uniquePhone());
    const boostedButPicky = await getAccessToken(uniquePhone());

    await buildCandidate(viewer.token, {
      displayName: 'E2E-Boost-Viewer2',
      birthYear: 1994, // age ~32
      gender: 'MALE',
      datingIntent: 'SERIOUS',
    });
    // Created BEFORE the boosted candidate, so plain (createdAt, id) order
    // would put her first — the real question is whether the boost jumps
    // the picky candidate ahead of her anyway.
    await buildCandidate(earlyPlain.token, {
      displayName: 'E2E-Boost-Early2',
      birthYear: 1994,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
    });
    await buildCandidate(boostedButPicky.token, {
      displayName: 'E2E-Boost-Picky',
      birthYear: 1994,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
    });
    // Only wants candidates aged 50-60 — the viewer (~32) doesn't qualify,
    // so the reciprocal check (FR-127) must deny this candidate's promotion.
    await request(app.getHttpServer())
      .patch('/v1/discovery/preferences')
      .set('Authorization', `Bearer ${boostedButPicky.token}`)
      .send({ minAge: 50, maxAge: 60 })
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/discovery/boost')
      .set('Authorization', `Bearer ${boostedButPicky.token}`)
      .expect(201);

    const candidates = await fetchFullDeck(app.getHttpServer(), viewer.token);
    const ids = candidates.map((c) => c.id);
    const earlyIndex = ids.indexOf(earlyPlain.userId);
    const pickyIndex = ids.indexOf(boostedButPicky.userId);

    expect(earlyIndex).toBeGreaterThanOrEqual(0);
    expect(pickyIndex).toBeGreaterThanOrEqual(0);
    // No promotion: the chronologically-earlier plain candidate still
    // precedes the boosted-but-reciprocally-excluded one, exactly the plain
    // (createdAt, id) order the boost would have overridden if it had wrongly
    // applied.
    expect(earlyIndex).toBeLessThan(pickyIndex);
  }, 60000);
});
