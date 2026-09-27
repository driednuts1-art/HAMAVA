import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import sharp from 'sharp';
import { io, Socket } from 'socket.io-client';
import { ReportReasonCategory, ReportStatus, UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { OTP_PROVIDER } from '../src/modules/auth/otp/otp-provider.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisIoAdapter } from '../src/common/websocket/redis-io.adapter';
import { uniquePhone } from './helpers/unique-phone';
import { fetchFullDeck } from './helpers/paginate-to-exhaustion';

interface VerifyResponseBody {
  accessToken: string;
  user: { id: string };
}

interface DeckCandidate {
  id: string;
}

interface SwipeResponseBody {
  matched: boolean;
  matchId?: string;
}

interface ConversationSummary {
  matchId: string;
  otherUser: { primaryPhotoId: string | null; primaryPhotoUrl: string | null };
}

interface MessageResponseBody {
  id: string;
  content: string;
}

interface ReportResponseBody {
  id: string;
  status: ReportStatus;
}

/**
 * End-to-end test for the Report/Block Flow (docs/requirements.md Feature
 * 5), run against real Postgres + real Redis (Upstash) + a real
 * socket.io-client — proving not just that block/report primitives exist,
 * but that a block's effect is bidirectional in the deck, asymmetric in
 * chat (the blocked party sees nothing different, per review), and that
 * the minimal admin review surface actually works end-to-end.
 */
describe('Report/Block Flow (e2e)', () => {
  let app: INestApplication<App>;
  let redisIoAdapter: RedisIoAdapter;
  let capturedCode: string;
  let baseUrl: string;
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

  async function buildVerifiedProfile(
    token: string,
    displayName: string,
  ): Promise<void> {
    const auth = `Bearer ${token}`;
    await request(app.getHttpServer())
      .patch('/v1/profile')
      .set('Authorization', auth)
      .send({
        displayName,
        birthDate: '1994-01-01',
        gender: 'MALE',
        datingIntent: 'SERIOUS',
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
        width: 30,
        height: 30,
        channels: 3,
        background: { r: 5, g: 5, b: 5 },
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

  async function createMatch(
    aliceToken: string,
    aliceId: string,
    bobToken: string,
    bobId: string,
  ): Promise<string> {
    const first = await request(app.getHttpServer())
      .post('/v1/discovery/swipes')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ targetUserId: bobId, action: 'LIKE' })
      .expect(201);
    if ((first.body as SwipeResponseBody).matched)
      return (first.body as SwipeResponseBody).matchId!;

    const second = await request(app.getHttpServer())
      .post('/v1/discovery/swipes')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ targetUserId: aliceId, action: 'LIKE' })
      .expect(201);
    const body = second.body as SwipeResponseBody;
    if (!body.matched) throw new Error('Expected a match to be created.');
    return body.matchId!;
  }

  async function promoteToAdmin(userId: string): Promise<void> {
    await app
      .get(PrismaService)
      .user.update({ where: { id: userId }, data: { role: UserRole.ADMIN } });
  }

  function connectSocket(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}/chat`, {
        auth: { token },
        transports: ['websocket'],
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
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

    // Must come *before* app.init() below, matching main.ts's real, fixed
    // ordering (docs/architecture.md §5.11's historical note, Feature 17) —
    // app.init() binds every @WebSocketGateway to whichever adapter is
    // active at that exact moment, silently no-op-ing a later
    // useWebSocketAdapter() call for gateways already initialized.
    redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);

    await app.init();

    const server = (await app.listen(0)) as {
      address: () => { port: number } | string | null;
    };
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await app
        .get(PrismaService)
        .user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await redisIoAdapter.close();
    await app.close();
  });

  it("excludes a blocked pair from each other's deck, bidirectionally (FR-67)", async () => {
    const alice = await getAccessToken(uniquePhone());
    const bob = await getAccessToken(uniquePhone());
    await buildVerifiedProfile(alice.token, 'RB-Alice');
    await buildVerifiedProfile(bob.token, 'RB-Bob');

    // Paginated to exhaustion, not a single-page snapshot — the real dev DB
    // never resets between e2e runs and keeps growing, so a brand-new
    // candidate can legitimately sort past a single page; see
    // test/helpers/paginate-to-exhaustion.ts.
    const deckBeforeCandidates = await fetchFullDeck<DeckCandidate>(
      app.getHttpServer(),
      alice.token,
    );
    expect(deckBeforeCandidates.map((c) => c.id)).toContain(bob.userId);

    // FR-71: block without any existing match.
    await request(app.getHttpServer())
      .post(`/v1/users/${bob.userId}/block`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(204);

    const aliceDeckAfter = await fetchFullDeck<DeckCandidate>(
      app.getHttpServer(),
      alice.token,
    );
    expect(aliceDeckAfter.map((c) => c.id)).not.toContain(bob.userId);

    const bobDeckAfter = await fetchFullDeck<DeckCandidate>(
      app.getHttpServer(),
      bob.token,
    );
    expect(bobDeckAfter.map((c) => c.id)).not.toContain(alice.userId);
  });

  it('rejects self-targeting and nonexistent targets on the standalone routes (FR-71)', async () => {
    const user = await getAccessToken(uniquePhone());

    await request(app.getHttpServer())
      .post(`/v1/users/${user.userId}/block`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(400);

    await request(app.getHttpServer())
      .post(`/v1/users/${randomUUID()}/block`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(404);
  });

  it('requires reason when category is OTHER, and audit-logs a submitted report (FR-72, FR-73)', async () => {
    const reporter = await getAccessToken(uniquePhone());
    const target = await getAccessToken(uniquePhone());

    await request(app.getHttpServer())
      .post(`/v1/users/${target.userId}/report`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ category: ReportReasonCategory.OTHER })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/v1/users/${target.userId}/report`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ category: ReportReasonCategory.SPAM })
      .expect(201);

    const auditEntry = await app.get(PrismaService).auditLog.findFirst({
      where: { action: 'REPORT_SUBMITTED', targetRef: target.userId },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(reporter.userId);
  });

  it('rejects a report once REPORT_RATE_LIMIT_PER_HOUR is exceeded, and audit-logs it (2026-09-18 audit — reports had no dedicated rate limit)', async () => {
    const reporter = await getAccessToken(uniquePhone());
    const target = await getAccessToken(uniquePhone());
    const limit = app
      .get(ConfigService)
      .getOrThrow<number>('REPORT_RATE_LIMIT_PER_HOUR');

    for (let i = 0; i < limit; i++) {
      await request(app.getHttpServer())
        .post(`/v1/users/${target.userId}/report`)
        .set('Authorization', `Bearer ${reporter.token}`)
        .send({ category: ReportReasonCategory.SPAM })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post(`/v1/users/${target.userId}/report`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ category: ReportReasonCategory.SPAM })
      .expect(429);

    const auditEntry = await app.get(PrismaService).auditLog.findFirst({
      where: { action: 'REPORT_RATE_LIMIT_EXCEEDED', actorId: reporter.userId },
    });
    expect(auditEntry).not.toBeNull();

    // A different reporter is never affected by another user's limit.
    const otherReporter = await getAccessToken(uniquePhone());
    await request(app.getHttpServer())
      .post(`/v1/users/${target.userId}/report`)
      .set('Authorization', `Bearer ${otherReporter.token}`)
      .send({ category: ReportReasonCategory.SPAM })
      .expect(201);
  });

  it('blocking an existing match hides it only for the blocker — the blocked party keeps full, unchanged access and their send is never pushed to the blocker (FR-68, FR-69, FR-70)', async () => {
    const carol = await getAccessToken(uniquePhone());
    const dave = await getAccessToken(uniquePhone());
    await buildVerifiedProfile(carol.token, 'RB-Carol');
    await buildVerifiedProfile(dave.token, 'RB-Dave');
    const matchId = await createMatch(
      carol.token,
      carol.userId,
      dave.token,
      dave.userId,
    );
    const carolAuth = `Bearer ${carol.token}`;
    const daveAuth = `Bearer ${dave.token}`;

    // Dave connects — he'll try to receive Carol's (nonexistent) reply,
    // and we'll prove his own send never reaches Carol's socket either.
    const daveSocket = await connectSocket(dave.token);
    const carolSocket = await connectSocket(carol.token);

    try {
      // Carol blocks Dave from inside the conversation (FR-64/FR-68's
      // carve-out: block/report stay reachable via the chat-scoped route
      // even once used).
      await request(app.getHttpServer())
        .post(`/v1/chat/conversations/${matchId}/block`)
        .set('Authorization', carolAuth)
        .expect(204);

      // --- Carol's (the blocker's) view: the match is gone. ---
      const carolConvos = (
        await request(app.getHttpServer())
          .get('/v1/chat/conversations')
          .set('Authorization', carolAuth)
          .expect(200)
      ).body as ConversationSummary[];
      expect(carolConvos.map((c) => c.matchId)).not.toContain(matchId);

      await request(app.getHttpServer())
        .get(`/v1/chat/conversations/${matchId}/messages`)
        .set('Authorization', carolAuth)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/v1/chat/conversations/${matchId}/read`)
        .set('Authorization', carolAuth)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/v1/chat/conversations/${matchId}/messages`)
        .set('Authorization', carolAuth)
        .send({
          content: 'can carol still talk?',
          clientIdempotencyKey: randomUUID(),
        })
        .expect(404);

      // Block/report themselves stay reachable for Carol regardless (FR-68's carve-out).
      await request(app.getHttpServer())
        .post(`/v1/chat/conversations/${matchId}/block`)
        .set('Authorization', carolAuth)
        .expect(204);
      await request(app.getHttpServer())
        .post(`/v1/chat/conversations/${matchId}/report`)
        .set('Authorization', carolAuth)
        .send({ category: ReportReasonCategory.HARASSMENT })
        .expect(201);

      // --- Dave's (the blocked party's) view: nothing looks different. ---
      const daveConvos = (
        await request(app.getHttpServer())
          .get('/v1/chat/conversations')
          .set('Authorization', daveAuth)
          .expect(200)
      ).body as ConversationSummary[];
      expect(daveConvos.map((c) => c.matchId)).toContain(matchId);

      // FR-93: a real, directly-fetchable primaryPhotoUrl, not just an id.
      const carolSummary = daveConvos.find((c) => c.matchId === matchId)!;
      expect(carolSummary.otherUser.primaryPhotoUrl).not.toBeNull();
      const carolPhotoRes = await fetch(
        carolSummary.otherUser.primaryPhotoUrl!,
      );
      expect(carolPhotoRes.status).toBe(200);

      await request(app.getHttpServer())
        .get(`/v1/chat/conversations/${matchId}/messages`)
        .set('Authorization', daveAuth)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/v1/chat/conversations/${matchId}/read`)
        .set('Authorization', daveAuth)
        .expect(204);

      const neverPushed = new Promise<boolean>((resolve) => {
        carolSocket.once('message:new', () => resolve(true));
        setTimeout(() => resolve(false), 2000);
      });

      const sendRes = await request(app.getHttpServer())
        .post(`/v1/chat/conversations/${matchId}/messages`)
        .set('Authorization', daveAuth)
        .send({
          content: 'can dave still talk?',
          clientIdempotencyKey: randomUUID(),
        })
        .expect(201);
      expect((sendRes.body as MessageResponseBody).content).toBe(
        'can dave still talk?',
      );

      // Dave's send persisted normally — he can read it back himself.
      const daveHistory = (
        await request(app.getHttpServer())
          .get(`/v1/chat/conversations/${matchId}/messages`)
          .set('Authorization', daveAuth)
          .expect(200)
      ).body as { messages: MessageResponseBody[] };
      expect(
        daveHistory.messages.some((m) => m.content === 'can dave still talk?'),
      ).toBe(true);

      // But it was never pushed to Carol's live socket.
      const pushArrived = await neverPushed;
      expect(pushArrived).toBe(false);
    } finally {
      daveSocket.disconnect();
      carolSocket.disconnect();
    }
  }, 30000);

  it('gates the admin report queue behind the ADMIN role and supports listing + resolving (FR-74, FR-75, FR-76)', async () => {
    const reporter = await getAccessToken(uniquePhone());
    const target = await getAccessToken(uniquePhone());
    const admin = await getAccessToken(uniquePhone());
    const nonAdmin = await getAccessToken(uniquePhone());

    const createRes = await request(app.getHttpServer())
      .post(`/v1/users/${target.userId}/report`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ category: ReportReasonCategory.SCAM_OR_FINANCIAL })
      .expect(201);
    const reportId = (createRes.body as ReportResponseBody).id;

    await request(app.getHttpServer())
      .get('/v1/admin/reports')
      .set('Authorization', `Bearer ${nonAdmin.token}`)
      .expect(403);

    await promoteToAdmin(admin.userId);

    const listRes = await request(app.getHttpServer())
      .get('/v1/admin/reports?status=OPEN&limit=100')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    const listed = (listRes.body as { reports: ReportResponseBody[] }).reports;
    expect(listed.map((r) => r.id)).toContain(reportId);

    const resolveRes = await request(app.getHttpServer())
      .patch(`/v1/admin/reports/${reportId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ resolutionNote: 'reviewed, no action needed' })
      .expect(200);
    expect((resolveRes.body as ReportResponseBody).status).toBe(
      ReportStatus.RESOLVED,
    );

    const auditEntry = await app.get(PrismaService).auditLog.findFirst({
      where: { action: 'REPORT_RESOLVED', targetRef: reportId },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(admin.userId);
  });
});
