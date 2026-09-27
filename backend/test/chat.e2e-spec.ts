import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import sharp from 'sharp';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { OTP_PROVIDER } from '../src/modules/auth/otp/otp-provider.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisIoAdapter } from '../src/common/websocket/redis-io.adapter';
import { uniquePhone } from './helpers/unique-phone';

interface VerifyResponseBody {
  accessToken: string;
  user: { id: string };
}

interface SwipeResponseBody {
  matched: boolean;
  matchId?: string;
}

interface MessageResponseBody {
  id: string;
  content: string;
  senderId: string;
  clientIdempotencyKey: string;
}

interface HistoryResponseBody {
  messages: MessageResponseBody[];
  nextCursor: string | null;
}

/**
 * End-to-end test for In-App Chat (docs/requirements.md Feature 4), run
 * against real Postgres + real Redis (Upstash) + a real socket.io client —
 * not a mock of the WebSocket layer. Proves a REST-persisted message
 * reaches a connected client over a real WebSocket in real time (FR-58).
 *
 * A real, important correction, made explicit here rather than silently
 * fixed (docs/architecture.md §5.11's own historical note has the full
 * trail): this file's own `beforeAll` — like `main.ts` before Feature 17's
 * fix — used to call `app.init()` *before* `app.useWebSocketAdapter(...)`,
 * which Nest silently no-ops for gateways already initialized. That meant
 * this suite, single-process by construction, had *always* exercised
 * Nest's plain default in-memory adapter, never `RedisIoAdapter` — and a
 * single-process in-memory adapter delivers a same-process room event
 * identically to a correctly-wired Redis one, so this test staying green
 * for 13 features never actually proved FR-59 (the real, Redis-backed,
 * *cross-instance* pub/sub delivery this app needs for horizontal
 * scaling). This file's own setup is now fixed to match `main.ts`'s real
 * ordering — but a single-process test still cannot prove cross-instance
 * delivery no matter how it's ordered; see the dedicated
 * `describe('Redis pub/sub — real cross-instance delivery (FR-59)', ...)`
 * block below, which spins up two independent app instances specifically
 * to close that real gap.
 */
describe('In-App Chat (e2e)', () => {
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
    // ordering (docs/architecture.md §5.11's historical note) — app.init()
    // is what binds every @WebSocketGateway to whichever adapter is active
    // at that exact moment, silently no-op-ing a later
    // useWebSocketAdapter() call for gateways already initialized. Real
    // Redis connections here have no DI-lifecycle dependency to wait for
    // (RedisIoAdapter opens its own, independent of RedisService), so
    // nothing blocks doing this first.
    redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);

    await app.init();

    // Real port — a real socket.io-client needs one (unlike REST calls via
    // supertest, which can inject requests without an actual listener).
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
    // Without this, the Redis client's reconnect loop keeps the process
    // alive indefinitely even after every test has passed — not optional.
    await redisIoAdapter.close();
    await app.close();
  });

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

  it('delivers a REST-sent message over WebSocket in real time via the Redis adapter (FR-58, FR-59)', async () => {
    const alice = await getAccessToken(uniquePhone());
    const bob = await getAccessToken(uniquePhone());
    await buildVerifiedProfile(alice.token, 'Chat-Alice');
    await buildVerifiedProfile(bob.token, 'Chat-Bob');
    const matchId = await createMatch(
      alice.token,
      alice.userId,
      bob.token,
      bob.userId,
    );

    const bobSocket = await connectSocket(bob.token);
    try {
      const received = new Promise<{ content: string }>((resolve) => {
        bobSocket.once('message:new', (msg: { content: string }) =>
          resolve(msg),
        );
      });

      const sendRes = await request(app.getHttpServer())
        .post(`/v1/chat/conversations/${matchId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({
          content: 'hello over the wire',
          clientIdempotencyKey: randomUUID(),
        })
        .expect(201);

      const pushed = await received;
      expect(pushed.content).toBe('hello over the wire');
      expect((sendRes.body as MessageResponseBody).content).toBe(
        'hello over the wire',
      );
    } finally {
      bobSocket.disconnect();
    }
  }, 30000);

  it('rejects a WebSocket connection without a valid token (FR-60)', async () => {
    const socket = io(`${baseUrl}/chat`, {
      auth: { token: 'not-a-real-token' },
      transports: ['websocket'],
    });
    const disconnected = new Promise<void>((resolve) => {
      socket.on('disconnect', () => resolve());
      socket.on('connect', () => resolve()); // fail the expectation below if this fires instead
    });
    await disconnected;
    expect(socket.connected).toBe(false);
    socket.close();
  });

  it('is idempotent, cursor-paginates history newest-first, respects blocks, and always exposes report (FR-53..FR-65)', async () => {
    const alice = await getAccessToken(uniquePhone());
    const bob = await getAccessToken(uniquePhone());
    await buildVerifiedProfile(alice.token, 'Chat2-Alice');
    await buildVerifiedProfile(bob.token, 'Chat2-Bob');
    const matchId = await createMatch(
      alice.token,
      alice.userId,
      bob.token,
      bob.userId,
    );
    const aliceAuth = `Bearer ${alice.token}`;
    const bobAuth = `Bearer ${bob.token}`;

    // FR-54: retrying the same idempotency key returns the same message.
    const key = randomUUID();
    const first = await request(app.getHttpServer())
      .post(`/v1/chat/conversations/${matchId}/messages`)
      .set('Authorization', aliceAuth)
      .send({ content: 'first', clientIdempotencyKey: key })
      .expect(201);
    const retry = await request(app.getHttpServer())
      .post(`/v1/chat/conversations/${matchId}/messages`)
      .set('Authorization', aliceAuth)
      .send({ content: 'first', clientIdempotencyKey: key })
      .expect(201);
    expect((retry.body as MessageResponseBody).id).toBe(
      (first.body as MessageResponseBody).id,
    );

    // Send a second, distinct message so history has 2 rows to paginate.
    await request(app.getHttpServer())
      .post(`/v1/chat/conversations/${matchId}/messages`)
      .set('Authorization', bobAuth)
      .send({
        content: 'second',
        clientIdempotencyKey: randomUUID(),
      })
      .expect(201);

    // FR-53: a non-participant cannot read history.
    const stranger = await getAccessToken(uniquePhone());
    await request(app.getHttpServer())
      .get(`/v1/chat/conversations/${matchId}/messages`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(403);

    // FR-62: cursor pagination, newest-first, no repeats.
    const page1 = await request(app.getHttpServer())
      .get(`/v1/chat/conversations/${matchId}/messages?limit=1`)
      .set('Authorization', aliceAuth)
      .expect(200);
    const page1Body = page1.body as HistoryResponseBody;
    expect(page1Body.messages).toHaveLength(1);
    expect(page1Body.messages[0].content).toBe('second'); // newest first
    expect(page1Body.nextCursor).toBeTruthy();

    const page2 = await request(app.getHttpServer())
      .get(
        `/v1/chat/conversations/${matchId}/messages?limit=1&cursor=${encodeURIComponent(page1Body.nextCursor!)}`,
      )
      .set('Authorization', aliceAuth)
      .expect(200);
    const page2Body = page2.body as HistoryResponseBody;
    expect(page2Body.messages[0].id).not.toBe(page1Body.messages[0].id);

    // FR-63: mark read, then FR-64/FR-68/FR-69/FR-70 (Feature 5): block is
    // asymmetric — Alice (the blocker) loses access, Bob (blocked) doesn't.
    // See test/report-block.e2e-spec.ts for the full asymmetric-block
    // scenario including WebSocket push-suppression; this just keeps the
    // Feature 4 flow's own block/report step accurate to the current design.
    await request(app.getHttpServer())
      .post(`/v1/chat/conversations/${matchId}/read`)
      .set('Authorization', aliceAuth)
      .expect(204);

    await request(app.getHttpServer())
      .post(`/v1/chat/conversations/${matchId}/block`)
      .set('Authorization', aliceAuth)
      .expect(204);

    // Bob (blocked party): sending still succeeds, no visible sign of the block.
    await request(app.getHttpServer())
      .post(`/v1/chat/conversations/${matchId}/messages`)
      .set('Authorization', bobAuth)
      .send({
        content: 'can bob still talk?',
        clientIdempotencyKey: randomUUID(),
      })
      .expect(201);

    // Alice (the blocker): the match is treated as if it doesn't exist.
    await request(app.getHttpServer())
      .post(`/v1/chat/conversations/${matchId}/messages`)
      .set('Authorization', aliceAuth)
      .send({
        content: 'can alice still talk?',
        clientIdempotencyKey: randomUUID(),
      })
      .expect(404);

    // FR-65/FR-68: report stays reachable from the conversation regardless of the block above.
    await request(app.getHttpServer())
      .post(`/v1/chat/conversations/${matchId}/report`)
      .set('Authorization', aliceAuth)
      .send({ category: 'HARASSMENT', reason: 'being weird' })
      .expect(201);
  }, 30000);
});

/**
 * FR-59, the real gap this suite exists to close: nothing anywhere in this
 * project — not this file's own single-instance test above, not
 * calls.e2e-spec.ts, not report-block.e2e-spec.ts — had ever actually
 * proven the Redis pub/sub adapter routes a `message:new` push across two
 * *separate* backend processes. Found while verifying Feature 17: `main.ts`
 * called `app.useWebSocketAdapter(redisIoAdapter)` *after* `app.init()`,
 * which Nest silently no-ops for gateways already bound — so `ChatGateway`
 * had been running on Nest's plain default in-memory adapter in every
 * environment this app has ever run in, including every one of those three
 * "real Redis" e2e suites, none of which ever noticed because a
 * single-process in-memory adapter delivers a same-process room event
 * identically to a correctly-wired Redis one. That silent equivalence is
 * exactly why this specific test needs two genuinely separate app
 * instances, each on its own real port, each with its own correctly-wired
 * `RedisIoAdapter` connected to the same real Redis — a message accepted by
 * instance A's REST endpoint can only reach a socket connected to instance
 * B via the real Redis pub/sub channel; instance A's own in-process
 * Socket.IO server has no other way to know instance B's socket exists at
 * all. If this ever regresses again (the exact ordering mistake `main.ts`
 * made once already), this is the one test in the whole suite built to
 * fail loudly and specifically for it, rather than silently pass.
 */
describe('Redis pub/sub — real cross-instance delivery (FR-59)', () => {
  let instanceA: INestApplication<App>;
  let instanceB: INestApplication<App>;
  let redisAdapterA: RedisIoAdapter;
  let redisAdapterB: RedisIoAdapter;
  let capturedCode: string;
  let baseUrlB: string;
  const createdUserIds: string[] = [];

  interface VerifyResponseBody2 {
    accessToken: string;
    user: { id: string };
  }
  interface SwipeResponseBody2 {
    matched: boolean;
    matchId?: string;
  }

  async function buildApp(): Promise<{
    app: INestApplication<App>;
    redisAdapter: RedisIoAdapter;
    baseUrl: string;
  }> {
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

    const app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new ProblemDetailsFilter());

    // The one line this whole test exists to hold accountable: the adapter
    // *must* be set before init(), on every instance, real and simulated
    // alike — see this file's own top-of-file note for the full history.
    const redisAdapter = new RedisIoAdapter(app);
    await redisAdapter.connectToRedis();
    app.useWebSocketAdapter(redisAdapter);
    await app.init();

    const server = (await app.listen(0)) as {
      address: () => { port: number } | string | null;
    };
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return { app, redisAdapter, baseUrl: `http://127.0.0.1:${port}` };
  }

  beforeAll(async () => {
    // Two fully independent Nest application instances — real, separate
    // HTTP+WebSocket servers on their own real ports, sharing nothing but
    // the same real Postgres and the same real Redis, exactly as two real
    // horizontally-scaled backend processes would.
    const [a, b] = await Promise.all([buildApp(), buildApp()]);
    instanceA = a.app;
    redisAdapterA = a.redisAdapter;
    instanceB = b.app;
    redisAdapterB = b.redisAdapter;
    baseUrlB = b.baseUrl;
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await instanceA
        .get(PrismaService)
        .user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await redisAdapterA.close();
    await redisAdapterB.close();
    await instanceA.close();
    await instanceB.close();
  });

  async function getAccessTokenOn(
    app: INestApplication<App>,
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
    const body = verifyRes.body as VerifyResponseBody2;
    createdUserIds.push(body.user.id);
    return { token: body.accessToken, userId: body.user.id };
  }

  async function buildVerifiedProfileOn(
    app: INestApplication<App>,
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
        background: { r: 7, g: 7, b: 7 },
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

  function connectSocketTo(baseUrl: string, token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}/chat`, {
        auth: { token },
        transports: ['websocket'],
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  }

  it('a message sent via one real backend instance is delivered over Redis pub/sub to a socket connected to a completely different instance', async () => {
    // Both real users, both profiles, and the match itself are created
    // through instance A's REST API — instance B's HTTP server is never
    // called for any of this, only its WebSocket server.
    const alice = await getAccessTokenOn(instanceA, uniquePhone());
    const bob = await getAccessTokenOn(instanceA, uniquePhone());
    await buildVerifiedProfileOn(instanceA, alice.token, 'PubSub-Alice');
    await buildVerifiedProfileOn(instanceA, bob.token, 'PubSub-Bob');

    const firstSwipe = (
      await request(instanceA.getHttpServer())
        .post('/v1/discovery/swipes')
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ targetUserId: bob.userId, action: 'LIKE' })
        .expect(201)
    ).body as SwipeResponseBody2;
    let matchId = firstSwipe.matchId;
    if (!firstSwipe.matched) {
      const secondSwipe = (
        await request(instanceA.getHttpServer())
          .post('/v1/discovery/swipes')
          .set('Authorization', `Bearer ${bob.token}`)
          .send({ targetUserId: alice.userId, action: 'LIKE' })
          .expect(201)
      ).body as SwipeResponseBody2;
      matchId = secondSwipe.matchId;
    }
    if (!matchId) throw new Error('Expected a real match to be created.');

    // Bob's real WebSocket client connects to instance B specifically —
    // a different real process from the one about to receive the send.
    const bobSocketOnInstanceB = await connectSocketTo(baseUrlB, bob.token);
    try {
      const received = new Promise<{ content: string }>((resolve) => {
        bobSocketOnInstanceB.once('message:new', (msg: { content: string }) =>
          resolve(msg),
        );
      });

      // Alice's real send goes to instance A's REST endpoint — a
      // different real process from the one Bob's socket is connected
      // to. The only real path from here to Bob's socket is instance A's
      // ChatGateway publishing to Redis and instance B's own gateway
      // instance picking it up from that same real channel.
      await request(instanceA.getHttpServer())
        .post(`/v1/chat/conversations/${matchId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({
          content: 'delivered across real instances via Redis',
          clientIdempotencyKey: randomUUID(),
        })
        .expect(201);

      const pushed = await received;
      expect(pushed.content).toBe('delivered across real instances via Redis');
    } finally {
      bobSocketOnInstanceB.disconnect();
    }
  }, 30000);
});
