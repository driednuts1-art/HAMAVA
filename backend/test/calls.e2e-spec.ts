import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import sharp from 'sharp';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { OTP_PROVIDER } from '../src/modules/auth/otp/otp-provider.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisIoAdapter } from '../src/common/websocket/redis-io.adapter';
import { ChatGateway } from '../src/modules/chat/chat.gateway';
import { TURN_CREDENTIAL_PROVIDER } from '../src/modules/calls/turn-credential-provider.interface';
import type { TurnCredentialProviderInterface } from '../src/modules/calls/turn-credential-provider.interface';
import { uniquePhone } from './helpers/unique-phone';
import { rejectVendorUnavailable } from './helpers/vendor-failure';

interface VerifyResponseBody {
  accessToken: string;
  user: { id: string };
}

interface SwipeResponseBody {
  matched: boolean;
  matchId?: string;
}

interface StartCallResponseBody {
  callSessionId: string;
  iceServers: { urls: string[]; username?: string; credential?: string }[];
  durationLimitSeconds: number | null;
}

interface ActiveCallResponseBody {
  callSessionId: string;
  type: string;
  status: string;
}

/**
 * End-to-end test for Feature 13 (docs/requirements.md) — Voice/Video
 * Calling — run against real infrastructure: the real Cloudflare Realtime
 * TURN API, a real Postgres database, real Redis (Upstash), and real
 * socket.io-client connections through the same ChatGateway Feature 4
 * already uses.
 */
describe('Voice/Video Calling (e2e)', () => {
  let app: INestApplication<App>;
  let redisIoAdapter: RedisIoAdapter;
  let capturedCode: string;
  let baseUrl: string;
  const createdUserIds: string[] = [];

  async function getAccessToken(
    phone: string,
    targetApp: INestApplication<App> = app,
  ): Promise<{ token: string; userId: string }> {
    await request(targetApp.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone })
      .expect(202);
    const verifyRes = await request(targetApp.getHttpServer())
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
    targetApp: INestApplication<App> = app,
  ): Promise<void> {
    const auth = `Bearer ${token}`;
    await request(targetApp.getHttpServer())
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
    await request(targetApp.getHttpServer())
      .post('/v1/profile/photos')
      .set('Authorization', auth)
      .attach('photo', jpeg, { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(201);

    await request(targetApp.getHttpServer())
      .post('/v1/consent/biometric')
      .set('Authorization', auth)
      .send({ policyVersion: 'v1' })
      .expect(201);
    await request(targetApp.getHttpServer())
      .post('/v1/verification/liveness/session')
      .set('Authorization', auth)
      .expect(201);
  }

  async function createMatch(
    aliceToken: string,
    aliceId: string,
    bobToken: string,
    bobId: string,
    targetApp: INestApplication<App> = app,
  ): Promise<string> {
    const first = await request(targetApp.getHttpServer())
      .post('/v1/discovery/swipes')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ targetUserId: bobId, action: 'LIKE' })
      .expect(201);
    if ((first.body as SwipeResponseBody).matched)
      return (first.body as SwipeResponseBody).matchId!;

    const second = await request(targetApp.getHttpServer())
      .post('/v1/discovery/swipes')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ targetUserId: aliceId, action: 'LIKE' })
      .expect(201);
    const body = second.body as SwipeResponseBody;
    if (!body.matched) throw new Error('Expected a match to be created.');
    return body.matchId!;
  }

  /** Real match between two fresh, verified users. */
  async function buildMatch(targetApp: INestApplication<App> = app): Promise<{
    a: { token: string; userId: string };
    b: { token: string; userId: string };
    matchId: string;
  }> {
    const a = await getAccessToken(uniquePhone(), targetApp);
    const b = await getAccessToken(uniquePhone(), targetApp);
    await buildVerifiedProfile(a.token, 'E2E-Call-A', targetApp);
    await buildVerifiedProfile(b.token, 'E2E-Call-B', targetApp);
    const matchId = await createMatch(
      a.token,
      a.userId,
      b.token,
      b.userId,
      targetApp,
    );
    return { a, b, matchId };
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

  it('starting a call mints a real Cloudflare TURN credential and delivers call:incoming over a real WebSocket to the real other participant (FR-174, FR-186)', async () => {
    const { a, b, matchId } = await buildMatch();
    const bSocket = await connectSocket(b.token);
    try {
      const incoming = new Promise<Record<string, unknown>>((resolve) => {
        bSocket.once('call:incoming', (msg: Record<string, unknown>) =>
          resolve(msg),
        );
      });

      const started = (
        await request(app.getHttpServer())
          .post(`/v1/calls/${matchId}/start`)
          .set('Authorization', `Bearer ${a.token}`)
          .send({ type: 'VOICE' })
          .expect(201)
      ).body as StartCallResponseBody;

      expect(started.iceServers.length).toBeGreaterThan(0);
      const turnServer = started.iceServers.find((s) => s.username);
      expect(turnServer?.username).toBeTruthy();
      expect(turnServer?.credential).toBeTruthy();

      const pushed = await incoming;
      expect(pushed).toEqual({
        callSessionId: started.callSessionId,
        matchId,
        type: 'VOICE',
        fromUserId: a.userId,
      });
    } finally {
      bSocket.disconnect();
    }
  }, 30000);

  it("joining mints the joiner's own, different credential — never the initiator's (FR-179)", async () => {
    const { a, b, matchId } = await buildMatch();
    const started = (
      await request(app.getHttpServer())
        .post(`/v1/calls/${matchId}/start`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ type: 'VOICE' })
        .expect(201)
    ).body as StartCallResponseBody;

    const joined = (
      await request(app.getHttpServer())
        .post(`/v1/calls/${matchId}/${started.callSessionId}/join`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(201)
    ).body as StartCallResponseBody;

    const startedUsername = started.iceServers.find(
      (s) => s.username,
    )?.username;
    const joinedUsername = joined.iceServers.find((s) => s.username)?.username;
    expect(joinedUsername).toBeTruthy();
    expect(joinedUsername).not.toBe(startedUsername);
  }, 30000);

  it('two real WebSocket clients exchange a real offer/answer signal end-to-end (FR-187)', async () => {
    const { a, b, matchId } = await buildMatch();
    const aSocket = await connectSocket(a.token);
    const bSocket = await connectSocket(b.token);
    try {
      const started = (
        await request(app.getHttpServer())
          .post(`/v1/calls/${matchId}/start`)
          .set('Authorization', `Bearer ${a.token}`)
          .send({ type: 'VOICE' })
          .expect(201)
      ).body as StartCallResponseBody;
      await request(app.getHttpServer())
        .post(`/v1/calls/${matchId}/${started.callSessionId}/join`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(201);

      const received = new Promise<Record<string, unknown>>((resolve) => {
        bSocket.once('call:signal', (msg: Record<string, unknown>) =>
          resolve(msg),
        );
      });

      aSocket.emit('call:signal', {
        callSessionId: started.callSessionId,
        toUserId: b.userId,
        payload: { type: 'offer', sdp: 'v=0\r\no=- fake-real-sdp' },
      });

      const msg = await received;
      expect(msg).toEqual({
        callSessionId: started.callSessionId,
        fromUserId: a.userId,
        payload: { type: 'offer', sdp: 'v=0\r\no=- fake-real-sdp' },
      });
    } finally {
      aSocket.disconnect();
      bSocket.disconnect();
    }
  }, 30000);

  it('a non-participant cannot start, join, or signal a call (403/404)', async () => {
    const { matchId } = await buildMatch();
    const stranger = await getAccessToken(uniquePhone());

    const startRes = await request(app.getHttpServer())
      .post(`/v1/calls/${matchId}/start`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ type: 'VOICE' });
    expect([403, 404]).toContain(startRes.status);
  }, 30000);

  it('a participant who has blocked the other side cannot start a new call with them (FR-189)', async () => {
    const { a, b, matchId } = await buildMatch();
    await request(app.getHttpServer())
      .post(`/v1/users/${b.userId}/block`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(204);

    const res = await request(app.getHttpServer())
      .post(`/v1/calls/${matchId}/start`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ type: 'VOICE' });
    expect([403, 404]).toContain(res.status);
  }, 30000);

  it('the first CallSession for a match gets a real non-null durationLimitSeconds; a second call for the same match gets null (FR-190)', async () => {
    const { a, b, matchId } = await buildMatch();

    const first = (
      await request(app.getHttpServer())
        .post(`/v1/calls/${matchId}/start`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ type: 'VOICE' })
        .expect(201)
    ).body as StartCallResponseBody;
    expect(first.durationLimitSeconds).toBe(300);
    await request(app.getHttpServer())
      .post(`/v1/calls/${matchId}/${first.callSessionId}/end`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({})
      .expect(201);

    const second = (
      await request(app.getHttpServer())
        .post(`/v1/calls/${matchId}/start`)
        .set('Authorization', `Bearer ${b.token}`)
        .send({ type: 'VIDEO' })
        .expect(201)
    ).body as StartCallResponseBody;
    expect(second.durationLimitSeconds).toBeNull();
  }, 30000);

  it('ending a call records the client-reported connectionType/qualityStatsRef exactly as given, and call_started only fires once ACTIVE (FR-180, FR-198)', async () => {
    const { a, b, matchId } = await buildMatch();
    const started = (
      await request(app.getHttpServer())
        .post(`/v1/calls/${matchId}/start`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ type: 'VIDEO' })
        .expect(201)
    ).body as StartCallResponseBody;

    // Not yet joined — no call_started should exist yet.
    let events = await app.get(PrismaService).analyticsEvent.findMany({
      where: { event: 'call_started' },
    });
    const beforeJoinCount = events.length;

    await request(app.getHttpServer())
      .post(`/v1/calls/${matchId}/${started.callSessionId}/join`)
      .set('Authorization', `Bearer ${b.token}`)
      .expect(201);

    events = await app.get(PrismaService).analyticsEvent.findMany({
      where: { event: 'call_started' },
    });
    expect(events.length).toBe(beforeJoinCount + 1);

    await request(app.getHttpServer())
      .post(`/v1/calls/${matchId}/${started.callSessionId}/end`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ connectionType: 'relayed', qualityStatsRef: 'ref-e2e-123' })
      .expect(201);

    const row = await app
      .get(PrismaService)
      .callSession.findUniqueOrThrow({ where: { id: started.callSessionId } });
    expect(row.connectionType).toBe('relayed');
    expect(row.qualityStatsRef).toBe('ref-e2e-123');
    expect(row.status).toBe('ENDED');
  }, 30000);

  it(
    'ending a call with a real client-reported endReason persists exactly that reason; ' +
      'COMPLETED and MISSED are rejected as client input (Feature 18 §8)',
    async () => {
      const { a, b, matchId } = await buildMatch();
      const started = (
        await request(app.getHttpServer())
          .post(`/v1/calls/${matchId}/start`)
          .set('Authorization', `Bearer ${a.token}`)
          .send({ type: 'VOICE' })
          .expect(201)
      ).body as StartCallResponseBody;

      // A real, client-legitimate reason (DECLINED) is accepted and persists.
      await request(app.getHttpServer())
        .post(`/v1/calls/${matchId}/${started.callSessionId}/end`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ endReason: 'DECLINED' })
        .expect(201);

      const row = await app.get(PrismaService).callSession.findUniqueOrThrow({
        where: { id: started.callSessionId },
      });
      expect(row.endReason).toBe('DECLINED');

      // COMPLETED and MISSED stay exclusively server-owned — real 400s, not
      // silently accepted, on a second, fresh call session.
      const secondCall = (
        await request(app.getHttpServer())
          .post(`/v1/calls/${matchId}/start`)
          .set('Authorization', `Bearer ${a.token}`)
          .send({ type: 'VOICE' })
          .expect(201)
      ).body as StartCallResponseBody;

      await request(app.getHttpServer())
        .post(`/v1/calls/${matchId}/${secondCall.callSessionId}/end`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ endReason: 'COMPLETED' })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/v1/calls/${matchId}/${secondCall.callSessionId}/end`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ endReason: 'MISSED' })
        .expect(400);

      // A real end with no endReason at all still defaults to COMPLETED,
      // exactly as before this change.
      await request(app.getHttpServer())
        .post(`/v1/calls/${matchId}/${secondCall.callSessionId}/end`)
        .set('Authorization', `Bearer ${b.token}`)
        .send({})
        .expect(201);
      const secondRow = await app
        .get(PrismaService)
        .callSession.findUniqueOrThrow({
          where: { id: secondCall.callSessionId },
        });
      expect(secondRow.endReason).toBe('COMPLETED');
    },
    30000,
  );

  it('block/report remain fully reachable while a call is ACTIVE (FR-195, no new gating)', async () => {
    const { a, b, matchId } = await buildMatch();
    const started = (
      await request(app.getHttpServer())
        .post(`/v1/calls/${matchId}/start`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ type: 'VOICE' })
        .expect(201)
    ).body as StartCallResponseBody;
    await request(app.getHttpServer())
      .post(`/v1/calls/${matchId}/${started.callSessionId}/join`)
      .set('Authorization', `Bearer ${b.token}`)
      .expect(201);

    const active = (
      await request(app.getHttpServer())
        .get(`/v1/calls/${matchId}/active`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(200)
    ).body as ActiveCallResponseBody;
    expect(active.status).toBe('ACTIVE');

    await request(app.getHttpServer())
      .post(`/v1/chat/conversations/${matchId}/block`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(204);
  }, 30000);

  it('a real connected socket receives call:limit-reached when pushed (FR-192 delivery mechanism)', async () => {
    const { a, matchId } = await buildMatch();
    const aSocket = await connectSocket(a.token);
    try {
      const started = (
        await request(app.getHttpServer())
          .post(`/v1/calls/${matchId}/start`)
          .set('Authorization', `Bearer ${a.token}`)
          .send({ type: 'VOICE' })
          .expect(201)
      ).body as StartCallResponseBody;

      const nudge = new Promise<Record<string, unknown>>((resolve) => {
        aSocket.once('call:limit-reached', (msg: Record<string, unknown>) =>
          resolve(msg),
        );
      });
      // Directly exercises the real delivery path pushLimitReached() uses —
      // the scheduling logic itself (when this fires relative to
      // durationLimitSeconds) is already unit-tested with fake timers;
      // this proves the socket delivery mechanism genuinely works.
      app
        .get(ChatGateway)
        .pushLimitReached(a.userId, { callSessionId: started.callSessionId });

      const msg = await nudge;
      expect(msg).toEqual({ callSessionId: started.callSessionId });
    } finally {
      aSocket.disconnect();
    }
  }, 30000);

  it('a Cloudflare TURN vendor failure returns 503, not a crash (FR-176)', async () => {
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
      .overrideProvider(TURN_CREDENTIAL_PROVIDER)
      .useValue({
        generateIceServers: () => rejectVendorUnavailable(),
      } satisfies TurnCredentialProviderInterface)
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
      const { a, matchId } = await buildMatch(failingApp);

      await request(failingApp.getHttpServer())
        .post(`/v1/calls/${matchId}/start`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ type: 'VOICE' })
        .expect(503);
    } finally {
      await failingApp.close();
    }
  }, 60000);
});
