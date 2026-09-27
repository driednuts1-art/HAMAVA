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

interface VerifyResponseBody {
  accessToken: string;
  user: { id: string };
}

interface SwipeResponseBody {
  matched: boolean;
  matchId?: string;
}

interface CreateDateShareResponseBody {
  id: string;
  token: string;
  expiresAt: string;
}

interface PublicDateShareResponseBody {
  sharerDisplayName: string | null;
  partnerDisplayName: string | null;
  partnerPhotoUrl: string | null;
  datetime: string;
  locationText: string;
}

/**
 * End-to-end test for Feature 12 (docs/requirements.md) — Share My Date —
 * run against real infrastructure: a real Postgres database and the real
 * S3-compatible presigned-URL mechanism (Feature 7). No AI vendor is
 * involved in this feature at all.
 */
describe('Share My Date (e2e)', () => {
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
    opts: { displayName: string; birthYear: number },
    verify: boolean,
  ): Promise<void> {
    const auth = `Bearer ${token}`;
    await request(app.getHttpServer())
      .patch('/v1/profile')
      .set('Authorization', auth)
      .send({
        displayName: opts.displayName,
        birthDate: `${opts.birthYear}-01-01`,
        gender: 'MALE',
        datingIntent: 'SERIOUS',
      })
      .expect(200);

    const jpeg = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 3,
        background: { r: 7, g: 8, b: 9 },
      },
    })
      .jpeg()
      .toBuffer();
    await request(app.getHttpServer())
      .post('/v1/profile/photos')
      .set('Authorization', auth)
      .attach('photo', jpeg, { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(201);

    if (verify) {
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

  /**
   * Real mutual match between two fresh users, second party (b) optionally
   * verified. FR-79 (Feature 6) blocks a match from ever forming between a
   * default (VERIFIED_ONLY) user and an unverified one — so when bVerified
   * is false, this sets `a`'s messagingPermission to EVERYONE first,
   * otherwise the swipe would silently produce `matched: false` rather than
   * a real match, and every unverified-partner test would be testing
   * nothing.
   */
  async function buildMatch(bVerified: boolean): Promise<{
    a: { token: string; userId: string };
    b: { token: string; userId: string };
    matchId: string;
  }> {
    const a = await getAccessToken(uniquePhone());
    const b = await getAccessToken(uniquePhone());
    await buildCandidate(
      a.token,
      { displayName: 'E2E-DS-A', birthYear: 1994 },
      true,
    );
    await buildCandidate(
      b.token,
      { displayName: 'E2E-DS-B', birthYear: 1993 },
      bVerified,
    );
    if (!bVerified) {
      await request(app.getHttpServer())
        .patch('/v1/users/me/privacy')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ messagingPermission: 'EVERYONE' })
        .expect(200);
    }

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
    expect(matchId).toBeTruthy(); // fail loudly here, not with a confusing 404 later
    return { a, b, matchId: matchId as string };
  }

  function hoursFromNow(hours: number): string {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
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

  it('a real link created for a real match is viewable with no Authorization header, returning exactly the whitelisted fields (FR-165)', async () => {
    const { a, matchId } = await buildMatch(true);

    const created = (
      await request(app.getHttpServer())
        .post(`/v1/discovery/matches/${matchId}/date-share`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ datetime: hoursFromNow(48), locationText: 'Cafe Golestan' })
        .expect(201)
    ).body as CreateDateShareResponseBody;

    const view = (
      await request(app.getHttpServer())
        .get(`/v1/date-share/${created.token}`)
        .expect(200)
    ).body as PublicDateShareResponseBody;

    expect(Object.keys(view).sort()).toEqual(
      [
        'sharerDisplayName',
        'partnerDisplayName',
        'partnerPhotoUrl',
        'datetime',
        'locationText',
      ].sort(),
    );
    expect(view.sharerDisplayName).toBe('E2E-DS-A');
    expect(view.partnerDisplayName).toBe('E2E-DS-B');
    expect(view.locationText).toBe('Cafe Golestan');
    expect(view.partnerPhotoUrl).toMatch(/^https?:\/\//);
  }, 60000);

  it('a non-participant cannot create a link for the match (403/404)', async () => {
    const { matchId } = await buildMatch(true);
    const stranger = await getAccessToken(uniquePhone());

    const res = await request(app.getHttpServer())
      .post(`/v1/discovery/matches/${matchId}/date-share`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ datetime: hoursFromNow(48), locationText: 'Cafe X' });
    expect([403, 404]).toContain(res.status);
  }, 60000);

  it('creating a link when the other participant is not verified is rejected (409, FR-156)', async () => {
    const { a, matchId } = await buildMatch(false);

    await request(app.getHttpServer())
      .post(`/v1/discovery/matches/${matchId}/date-share`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ datetime: hoursFromNow(48), locationText: 'Cafe X' })
      .expect(409);
  }, 60000);

  it('a past datetime is rejected before any token is generated (400, FR-157)', async () => {
    const { a, matchId } = await buildMatch(true);
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    await request(app.getHttpServer())
      .post(`/v1/discovery/matches/${matchId}/date-share`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ datetime: past, locationText: 'Cafe X' })
      .expect(400);
  }, 60000);

  it('expiresAt is datetime + DATE_SHARE_LINK_BUFFER_HOURS, not createdAt-relative (FR-157)', async () => {
    const { a, matchId } = await buildMatch(true);
    const datetime = hoursFromNow(96); // four days out

    const created = (
      await request(app.getHttpServer())
        .post(`/v1/discovery/matches/${matchId}/date-share`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ datetime, locationText: 'Cafe X' })
        .expect(201)
    ).body as CreateDateShareResponseBody;

    const expectedExpiry = new Date(datetime).getTime() + 24 * 60 * 60 * 1000;
    expect(new Date(created.expiresAt).getTime()).toBe(expectedExpiry);
    // Sanity: a naive createdAt-relative implementation would put this in
    // the past relative to a 4-day-out date — explicitly rule that out.
    expect(new Date(created.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 95 * 60 * 60 * 1000,
    );
  }, 60000);

  it('the stored tokenHash never equals the raw token, and the raw token cannot be recovered from the row (FR-159)', async () => {
    const { a, matchId } = await buildMatch(true);

    const created = (
      await request(app.getHttpServer())
        .post(`/v1/discovery/matches/${matchId}/date-share`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ datetime: hoursFromNow(48), locationText: 'Cafe X' })
        .expect(201)
    ).body as CreateDateShareResponseBody;

    const row = await app
      .get(PrismaService)
      .dateShareLink.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.tokenHash).not.toBe(created.token);
    expect(JSON.stringify(row)).not.toContain(created.token);
  }, 60000);

  it('an expired link, a revoked link, and a token that never existed all return the exact same 404 body (FR-164)', async () => {
    const { a, matchId } = await buildMatch(true);

    const revoked = (
      await request(app.getHttpServer())
        .post(`/v1/discovery/matches/${matchId}/date-share`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ datetime: hoursFromNow(48), locationText: 'Cafe X' })
        .expect(201)
    ).body as CreateDateShareResponseBody;
    await request(app.getHttpServer())
      .delete(`/v1/discovery/matches/${matchId}/date-share/${revoked.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);

    // Directly craft an "expired" row via a real create + a direct DB update
    // (no real-time waiting) — still a real row through the real lookup path.
    const expiring = (
      await request(app.getHttpServer())
        .post(`/v1/discovery/matches/${matchId}/date-share`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ datetime: hoursFromNow(48), locationText: 'Cafe X' })
        .expect(201)
    ).body as CreateDateShareResponseBody;
    await app.get(PrismaService).dateShareLink.update({
      where: { id: expiring.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const neverExistedRes = await request(app.getHttpServer())
      .get('/v1/date-share/this-token-never-existed')
      .expect(404);
    const revokedRes = await request(app.getHttpServer())
      .get(`/v1/date-share/${revoked.token}`)
      .expect(404);
    const expiredRes = await request(app.getHttpServer())
      .get(`/v1/date-share/${expiring.token}`)
      .expect(404);

    // `instance` legitimately reflects the request path (which naturally
    // contains the different token each call used) — not itself a leak,
    // since the caller already knows which token it requested. Everything
    // that actually describes *why* the request failed must be identical.
    const meaningful = (body: Record<string, unknown>) => {
      const rest = { ...body };
      delete rest.instance;
      return rest;
    };
    expect(meaningful(neverExistedRes.body as Record<string, unknown>)).toEqual(
      meaningful(revokedRes.body as Record<string, unknown>),
    );
    expect(meaningful(revokedRes.body as Record<string, unknown>)).toEqual(
      meaningful(expiredRes.body as Record<string, unknown>),
    );
  }, 60000);

  it("the other participant's opt-out (allowInSafetyShares) is checked at creation time, and re-enabling it unblocks creation (FR-171..FR-173)", async () => {
    const { a, b, matchId } = await buildMatch(true);

    await request(app.getHttpServer())
      .patch('/v1/users/me/privacy')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ allowInSafetyShares: false })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/v1/discovery/matches/${matchId}/date-share`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ datetime: hoursFromNow(48), locationText: 'Cafe X' })
      .expect(409);

    await request(app.getHttpServer())
      .patch('/v1/users/me/privacy')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ allowInSafetyShares: true })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/v1/discovery/matches/${matchId}/date-share`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ datetime: hoursFromNow(48), locationText: 'Cafe X' })
      .expect(201);
  }, 60000);

  it('allowInSafetyShares defaults to true for a freshly created user (direct DB check)', async () => {
    const { userId } = await getAccessToken(uniquePhone());
    const row = await app
      .get(PrismaService)
      .user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.allowInSafetyShares).toBe(true);
  }, 30000);

  it('a successful creation emits a real date_shared AnalyticsEvent row with no identifying properties (FR-170)', async () => {
    const { a, matchId } = await buildMatch(true);

    await request(app.getHttpServer())
      .post(`/v1/discovery/matches/${matchId}/date-share`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ datetime: hoursFromNow(48), locationText: 'Very Specific Cafe' })
      .expect(201);

    const events = await app.get(PrismaService).analyticsEvent.findMany({
      where: { userId: a.userId, event: 'date_shared' },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const payload = JSON.stringify(events[0].properties);
    expect(payload).not.toContain('Very Specific Cafe');
    expect(payload).not.toContain('E2E-DS-A');
  }, 60000);

  it('exceeding the per-IP public-lookup rate limit returns 429 (FR-169, real repeated HTTP calls)', async () => {
    const { a, matchId } = await buildMatch(true);
    const created = (
      await request(app.getHttpServer())
        .post(`/v1/discovery/matches/${matchId}/date-share`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ datetime: hoursFromNow(48), locationText: 'Cafe X' })
        .expect(201)
    ).body as CreateDateShareResponseBody;

    const limit = 100; // DATE_SHARE_LOOKUP_RATE_LIMIT_PER_IP_PER_MINUTE in .env
    // Fired concurrently, not sequentially — 101 sequential round-trips to
    // the real (remote) Neon database would comfortably exceed Jest's
    // per-test timeout; concurrent calls are also a more realistic
    // simulation of the abuse pattern this limit actually defends against.
    const responses = await Promise.all(
      Array.from({ length: limit + 1 }, () =>
        request(app.getHttpServer()).get(`/v1/date-share/${created.token}`),
      ),
    );
    expect(responses.map((r) => r.status)).toContain(429);
  }, 120000);
});
