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
import { PrismaService } from '../src/prisma/prisma.service';
import { uniquePhone } from './helpers/unique-phone';
import { fetchFullDeck } from './helpers/paginate-to-exhaustion';

interface VerifyResponseBody {
  accessToken: string;
  user: { id: string };
}

interface DeckCandidate {
  id: string;
  displayName: string | null;
  photos: { id: string; position: number; url: string }[];
  isNewMember: boolean;
}

interface DeckResponseBody {
  candidates: DeckCandidate[];
  nextCursor: string | null;
}

interface SwipeResponseBody {
  matched: boolean;
  matchId?: string;
}

interface MatchSummary {
  matchId: string;
  user: { id: string };
}

/**
 * End-to-end test for the Swipe Deck (docs/requirements.md Feature 3), run
 * against a real database connection. Builds three real users through the
 * real HTTP auth + profile + liveness endpoints (no shortcuts into the DB),
 * then exercises deck filtering, exclusion, matching, and pagination.
 */
describe('Swipe Deck (e2e)', () => {
  let app: INestApplication<App>;
  let capturedCode: string;
  // Deleted in afterAll so re-running this suite doesn't leave real rows
  // behind — this is exactly the pollution that caused a false-positive
  // deck-exclusion failure before this cleanup + the id-based assertions existed.
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

  async function buildCompleteProfile(
    token: string,
    opts: {
      displayName: string;
      birthYear: number;
      gender: string;
      datingIntent: string;
      verify: boolean;
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
        // Feature 24 (FR-435): profile completeness now also requires 2
        // real prompt answers, alongside displayName/birthDate/photo.
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

    if (opts.verify) {
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

  it('filters by verified-only (default on), excludes swiped candidates, and matches on mutual like', async () => {
    const alice = await getAccessToken(uniquePhone());
    const bob = await getAccessToken(uniquePhone());
    const carol = await getAccessToken(uniquePhone());

    await buildCompleteProfile(alice.token, {
      displayName: 'E2E-Alice',
      birthYear: 1995,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });
    await buildCompleteProfile(bob.token, {
      displayName: 'E2E-Bob',
      birthYear: 1993,
      gender: 'MALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });
    await buildCompleteProfile(carol.token, {
      displayName: 'E2E-Carol',
      birthYear: 1996,
      gender: 'FEMALE',
      datingIntent: 'CASUAL',
      verify: false, // stays unverified
    });

    const bobAuth = `Bearer ${bob.token}`;

    // FR-47: verifiedOnly defaults to true without Bob ever setting it.
    const prefsRes = await request(app.getHttpServer())
      .get('/v1/discovery/preferences')
      .set('Authorization', bobAuth)
      .expect(200);
    expect((prefsRes.body as { verifiedOnly: boolean }).verifiedOnly).toBe(
      true,
    );

    // FR-48: with verifiedOnly=true, unverified Carol must not appear to Bob.
    // Paginated to exhaustion (not a single-page snapshot) — the real dev
    // DB never resets between e2e runs and keeps growing, so Alice (a
    // brand-new candidate) can legitimately sort past a single page; see
    // test/helpers/paginate-to-exhaustion.ts.
    const deckBeforeCandidates = await fetchFullDeck<DeckCandidate>(
      app.getHttpServer(),
      bob.token,
    );
    // Compare by id, not displayName — the shared dev DB can carry leftover
    // users from earlier test runs with the same display name (different id).
    const idsBefore = deckBeforeCandidates.map((c) => c.id);
    expect(idsBefore).toContain(alice.userId);
    expect(idsBefore).not.toContain(carol.userId);

    // FR-92: the deck exposes a real, directly-fetchable photo URL — not just an id.
    const aliceCandidate = deckBeforeCandidates.find(
      (c) => c.id === alice.userId,
    )!;
    expect(aliceCandidate.photos.length).toBeGreaterThan(0);
    const aliceDeckPhotoRes = await fetch(aliceCandidate.photos[0].url);
    expect(aliceDeckPhotoRes.status).toBe(200);

    // Bob swipes: PASS on nobody relevant here, LIKE on Alice (one-directional, no match yet).
    const firstLike = (
      await request(app.getHttpServer())
        .post('/v1/discovery/swipes')
        .set('Authorization', bobAuth)
        .send({ targetUserId: alice.userId, action: 'LIKE' })
        .expect(201)
    ).body as SwipeResponseBody;
    expect(firstLike.matched).toBe(false);

    // FR-40: swiping the same target again is rejected, not overwritten.
    await request(app.getHttpServer())
      .post('/v1/discovery/swipes')
      .set('Authorization', bobAuth)
      .send({ targetUserId: alice.userId, action: 'LIKE' })
      .expect(409);

    // FR-38: Alice, already swiped on, must not reappear in Bob's deck.
    const deckAfter = (
      await request(app.getHttpServer())
        .get('/v1/discovery/deck?limit=50')
        .set('Authorization', bobAuth)
        .expect(200)
    ).body as DeckResponseBody;
    expect(deckAfter.candidates.map((c) => c.id)).not.toContain(alice.userId);

    // FR-41: Alice likes Bob back -> exactly one Match, reported immediately.
    const matchResult = (
      await request(app.getHttpServer())
        .post('/v1/discovery/swipes')
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ targetUserId: bob.userId, action: 'LIKE' })
        .expect(201)
    ).body as SwipeResponseBody;
    expect(matchResult.matched).toBe(true);
    expect(matchResult.matchId).toBeDefined();

    // FR-45: both sides see the match.
    const aliceMatches = (
      await request(app.getHttpServer())
        .get('/v1/discovery/matches')
        .set('Authorization', `Bearer ${alice.token}`)
        .expect(200)
    ).body as MatchSummary[];
    const bobMatches = (
      await request(app.getHttpServer())
        .get('/v1/discovery/matches')
        .set('Authorization', bobAuth)
        .expect(200)
    ).body as MatchSummary[];
    expect(aliceMatches).toHaveLength(1);
    expect(bobMatches).toHaveLength(1);
    expect(aliceMatches[0].matchId).toBe(matchResult.matchId);
    expect(aliceMatches[0].user.id).toBe(bob.userId);
    expect(bobMatches[0].user.id).toBe(alice.userId);
  });

  it('rejects swiping on yourself', async () => {
    const user = await getAccessToken(uniquePhone());
    await request(app.getHttpServer())
      .post('/v1/discovery/swipes')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ targetUserId: user.userId, action: 'LIKE' })
      .expect(400);
  });

  // Real bug, found via direct browser reproduction during manual testing
  // (docs/requirements.md Feature 16 §12): once a user has ever saved
  // preferences, GET /v1/discovery/preferences returned the full Prisma row
  // (userId/updatedAt included, since findUnique() had no select clause).
  // The frontend's filters panel (components/discovery/filters-panel.tsx)
  // spreads that exact GET response into its own PATCH body — a real,
  // reproducible 400 ("property userId should not exist...") on every
  // subsequent "apply filters" click, for any user, independent of deck
  // state. Reproduces the exact real-world sequence: PATCH once (creating a
  // real row), GET it back, PATCH again with the GET response's own body —
  // must succeed, not 400.
  it('a GET response can be sent straight back as a PATCH body without a 400 — the real frontend "edit current values" pattern (regression)', async () => {
    const user = await getAccessToken(uniquePhone());
    const auth = `Bearer ${user.token}`;

    // First save — creates a real DiscoveryPreferences row.
    await request(app.getHttpServer())
      .patch('/v1/discovery/preferences')
      .set('Authorization', auth)
      .send({ verifiedOnly: false })
      .expect(200);

    const getRes = await request(app.getHttpServer())
      .get('/v1/discovery/preferences')
      .set('Authorization', auth)
      .expect(200);

    // The real contract this bug violated: GET's response must never carry
    // more than PATCH's own DTO accepts.
    expect(Object.keys(getRes.body as object).sort()).toEqual(
      [
        'activeThisWeekOnly',
        'genderPref',
        'maxAge',
        'minAge',
        'newMembersOnly',
        'relationshipGoalPref',
        'verifiedOnly',
      ].sort(),
    );

    // The real frontend pattern: send the just-fetched object straight back.
    await request(app.getHttpServer())
      .patch('/v1/discovery/preferences')
      .set('Authorization', auth)
      .send(getRes.body as object)
      .expect(200);
  });

  it('paginates the deck with a cursor without repeating a candidate', async () => {
    const viewer = await getAccessToken(uniquePhone());
    const c1 = await getAccessToken(uniquePhone());
    const c2 = await getAccessToken(uniquePhone());

    await buildCompleteProfile(viewer.token, {
      displayName: 'E2E-Viewer',
      birthYear: 1990,
      gender: 'MALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });
    await buildCompleteProfile(c1.token, {
      displayName: 'E2E-Cand1',
      birthYear: 1990,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });
    await buildCompleteProfile(c2.token, {
      displayName: 'E2E-Cand2',
      birthYear: 1990,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });

    const auth = `Bearer ${viewer.token}`;
    const page1 = (
      await request(app.getHttpServer())
        .get('/v1/discovery/deck?limit=1')
        .set('Authorization', auth)
        .expect(200)
    ).body as DeckResponseBody;
    expect(page1.candidates).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = (
      await request(app.getHttpServer())
        .get(
          `/v1/discovery/deck?limit=1&cursor=${encodeURIComponent(page1.nextCursor!)}`,
        )
        .set('Authorization', auth)
        .expect(200)
    ).body as DeckResponseBody;
    expect(page2.candidates).toHaveLength(1);
    expect(page2.candidates[0].id).not.toBe(page1.candidates[0].id); // FR-36
  });

  // Feature 27 (FR-489/FR-490/FR-494): the New Members filter is a
  // structural copy of activeThisWeekOnly's own where-builder branch inside
  // DeckService.getDeck() — every candidate it returns has already passed
  // through the exact same buildSafetyExclusionWhere() call every other
  // deck query does. This test proves that empirically against the real
  // backend, not just by reading the code: a blocked user, and (with
  // verifiedOnly left at its real default of true) an unverified user, must
  // both still be excluded once newMembersOnly is turned on.
  it('the New Members filter still excludes a blocked user and an unverified one — same buildSafetyExclusionWhere floor as every other deck query (FR-489/FR-490/FR-494)', async () => {
    const alice = await getAccessToken(uniquePhone());
    const bob = await getAccessToken(uniquePhone());
    const carol = await getAccessToken(uniquePhone());

    await buildCompleteProfile(alice.token, {
      displayName: 'E2E-NewAlice',
      birthYear: 1994,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });
    // Bob and Carol are both freshly created just now (real DB createdAt),
    // so both are genuinely, honestly "new members" — no faked timestamp.
    await buildCompleteProfile(bob.token, {
      displayName: 'E2E-NewBob',
      birthYear: 1992,
      gender: 'MALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });
    await buildCompleteProfile(carol.token, {
      displayName: 'E2E-NewCarol',
      birthYear: 1996,
      gender: 'FEMALE',
      datingIntent: 'CASUAL',
      verify: false, // stays unverified
    });

    const aliceAuth = `Bearer ${alice.token}`;
    await request(app.getHttpServer())
      .patch('/v1/discovery/preferences')
      .set('Authorization', aliceAuth)
      .send({ newMembersOnly: true })
      .expect(200);

    // Both Bob and Carol are real, brand-new members — Carol is excluded
    // only by the pre-existing verifiedOnly=true default, not by anything
    // new here.
    const beforeBlock = await fetchFullDeck<DeckCandidate>(
      app.getHttpServer(),
      alice.token,
    );
    const idsBeforeBlock = beforeBlock.map((c) => c.id);
    expect(idsBeforeBlock).toContain(bob.userId);
    expect(idsBeforeBlock).not.toContain(carol.userId);
    const bobCandidate = beforeBlock.find((c) => c.id === bob.userId)!;
    expect(bobCandidate.isNewMember).toBe(true); // FR-490

    // FR-494: block Bob, then confirm the New Members list drops him too —
    // proving newMembersOnly shares buildSafetyExclusionWhere's exclusion,
    // not a second, parallel query that could forget it.
    await request(app.getHttpServer())
      .post(`/v1/users/${bob.userId}/block`)
      .set('Authorization', aliceAuth)
      .expect(204);

    const afterBlock = await fetchFullDeck<DeckCandidate>(
      app.getHttpServer(),
      alice.token,
    );
    expect(afterBlock.map((c) => c.id)).not.toContain(bob.userId);
  });
});
