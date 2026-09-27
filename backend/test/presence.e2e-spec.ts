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
import { uniquePhone } from './helpers/unique-phone';

interface VerifyResponseBody {
  accessToken: string;
  user: { id: string };
}
interface SwipeResponseBody {
  matched: boolean;
  matchId?: string;
}
interface PresenceValue {
  online: boolean;
  lastOnlineAt: string | null;
}
interface MatchSummary {
  matchId: string;
  user: { id: string; presence: PresenceValue | null };
}

/**
 * End-to-end test for Feature 27's online-status presence system
 * (docs/requirements.md §2/§3, FR-480..FR-486). Real Postgres + real shared
 * Redis + real socket.io-client connections against two genuinely separate
 * Nest application instances — proving presence is backed by shared Redis
 * state (readable from any process), not per-instance in-memory state,
 * mirroring chat.e2e-spec.ts's own FR-59 cross-instance rigor. Unlike that
 * suite, this one does not need `RedisIoAdapter`/`useWebSocketAdapter` at
 * all: presence never relies on Socket.IO's own room/pub-sub delivery, only
 * on `PresenceService` reading/writing the one real Redis instance both app
 * processes already share via the same `REDIS_URL`.
 */
describe('Online Status / Presence (e2e, Feature 27)', () => {
  let instanceA: INestApplication<App>;
  let instanceB: INestApplication<App>;
  let capturedCode: string;
  let baseUrlA: string;
  let baseUrlB: string;
  const createdUserIds: string[] = [];

  async function buildApp(): Promise<{
    app: INestApplication<App>;
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
    await app.init();

    const server = (await app.listen(0)) as {
      address: () => { port: number } | string | null;
    };
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return { app, baseUrl: `http://127.0.0.1:${port}` };
  }

  beforeAll(async () => {
    const [a, b] = await Promise.all([buildApp(), buildApp()]);
    instanceA = a.app;
    baseUrlA = a.baseUrl;
    instanceB = b.app;
    baseUrlB = b.baseUrl;
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await instanceA
        .get(PrismaService)
        .user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
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
    const body = verifyRes.body as VerifyResponseBody;
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
        background: { r: 9, g: 9, b: 9 },
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

  async function matchThem(
    app: INestApplication<App>,
    alice: { token: string; userId: string },
    bob: { token: string; userId: string },
  ): Promise<string> {
    const firstSwipe = (
      await request(app.getHttpServer())
        .post('/v1/discovery/swipes')
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ targetUserId: bob.userId, action: 'LIKE' })
        .expect(201)
    ).body as SwipeResponseBody;
    if (firstSwipe.matched) return firstSwipe.matchId!;
    const secondSwipe = (
      await request(app.getHttpServer())
        .post('/v1/discovery/swipes')
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ targetUserId: alice.userId, action: 'LIKE' })
        .expect(201)
    ).body as SwipeResponseBody;
    if (!secondSwipe.matchId) throw new Error('Expected a real match.');
    return secondSwipe.matchId;
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

  async function getBobPresence(
    aliceToken: string,
    bobUserId: string,
  ): Promise<PresenceValue | null> {
    const matches = (
      await request(instanceA.getHttpServer())
        .get('/v1/discovery/matches')
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200)
    ).body as MatchSummary[];
    return matches.find((m) => m.user.id === bobUserId)!.user.presence;
  }

  /** Real async server-side disconnect handling — poll instead of guessing a fixed delay. */
  async function waitUntil<T>(
    fn: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeoutMs = 5000,
  ): Promise<T> {
    const start = Date.now();
    for (;;) {
      const value = await fn();
      if (predicate(value)) return value;
      if (Date.now() - start > timeoutMs) {
        throw new Error('waitUntil: condition never became true in time.');
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  it('a real socket connected on a completely different instance shows as online via shared Redis, then offline (with a fresh lastOnlineAt) once it disconnects (FR-480..FR-482, FR-493)', async () => {
    const alice = await getAccessTokenOn(instanceA, uniquePhone());
    const bob = await getAccessTokenOn(instanceA, uniquePhone());
    await buildVerifiedProfileOn(instanceA, alice.token, 'Presence-Alice1');
    await buildVerifiedProfileOn(instanceA, bob.token, 'Presence-Bob1');
    await matchThem(instanceA, alice, bob);

    // Before Bob ever connects a socket anywhere: never fabricate an
    // "online" claim, and there's no lastOnlineAt yet either.
    const before = await getBobPresence(alice.token, bob.userId);
    expect(before).toEqual({ online: false, lastOnlineAt: null });

    // Bob's real WebSocket client connects to instance B — a different
    // real process from the one Alice's REST read hits (instance A). The
    // only way instance A's REST read can see this is real, shared Redis
    // state (PresenceService), never in-process memory.
    const bobSocketOnB = await connectSocketTo(baseUrlB, bob.token);
    try {
      const online = await waitUntil(
        () => getBobPresence(alice.token, bob.userId),
        (p) => p?.online === true,
      );
      expect(online?.online).toBe(true);
    } finally {
      bobSocketOnB.disconnect();
    }

    // FR-481/FR-482: once Bob's one and only connection closes, he goes
    // offline immediately (not waiting for the 45s TTL) and a real,
    // fresh lastOnlineAt is stamped.
    const afterDisconnectAt = Date.now();
    const offline = await waitUntil(
      () => getBobPresence(alice.token, bob.userId),
      (p) => p?.online === false,
    );
    expect(offline?.lastOnlineAt).not.toBeNull();
    const lastOnlineAtMs = new Date(offline!.lastOnlineAt!).getTime();
    expect(lastOnlineAtMs).toBeGreaterThan(afterDisconnectAt - 5000);
    expect(lastOnlineAtMs).toBeLessThanOrEqual(Date.now());
  }, 60000);

  it('closing one of two open connections keeps the user online — only the last one closing goes offline (FR-481)', async () => {
    const alice = await getAccessTokenOn(instanceA, uniquePhone());
    const bob = await getAccessTokenOn(instanceA, uniquePhone());
    await buildVerifiedProfileOn(instanceA, alice.token, 'Presence-Alice2');
    await buildVerifiedProfileOn(instanceA, bob.token, 'Presence-Bob2');
    await matchThem(instanceA, alice, bob);

    // Two real connections for Bob — one per instance, simulating two
    // open tabs/devices on two different backend processes.
    const bobSocketOnA = await connectSocketTo(baseUrlA, bob.token);
    const bobSocketOnB = await connectSocketTo(baseUrlB, bob.token);

    try {
      await waitUntil(
        () => getBobPresence(alice.token, bob.userId),
        (p) => p?.online === true,
      );

      // Close only one of the two — Bob must stay online.
      bobSocketOnA.disconnect();
      await new Promise((r) => setTimeout(r, 500));
      const stillOnline = await getBobPresence(alice.token, bob.userId);
      expect(stillOnline?.online).toBe(true);

      // Close the second, last remaining connection — now genuinely offline.
      bobSocketOnB.disconnect();
      const nowOffline = await waitUntil(
        () => getBobPresence(alice.token, bob.userId),
        (p) => p?.online === false,
      );
      expect(nowOffline?.online).toBe(false);
    } finally {
      bobSocketOnA.disconnect();
      bobSocketOnB.disconnect();
    }
  }, 60000);

  it('the symmetric privacy toggle hides presence both ways when either side turns it off (FR-484/FR-485)', async () => {
    const alice = await getAccessTokenOn(instanceA, uniquePhone());
    const bob = await getAccessTokenOn(instanceA, uniquePhone());
    await buildVerifiedProfileOn(instanceA, alice.token, 'Presence-Alice3');
    await buildVerifiedProfileOn(instanceA, bob.token, 'Presence-Bob3');
    await matchThem(instanceA, alice, bob);

    const bobSocketOnB = await connectSocketTo(baseUrlB, bob.token);
    try {
      await waitUntil(
        () => getBobPresence(alice.token, bob.userId),
        (p) => p?.online === true,
      );

      // Bob turns his own toggle off — Alice must now see nothing at all
      // for him, not "shown as offline."
      await request(instanceA.getHttpServer())
        .patch('/v1/users/me/privacy')
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ showLastActiveStatus: false })
        .expect(200);

      const hiddenByBob = await getBobPresence(alice.token, bob.userId);
      expect(hiddenByBob).toBeNull();

      // Restore Bob's toggle, confirm visible again.
      await request(instanceA.getHttpServer())
        .patch('/v1/users/me/privacy')
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ showLastActiveStatus: true })
        .expect(200);
      const visibleAgain = await getBobPresence(alice.token, bob.userId);
      expect(visibleAgain).not.toBeNull();

      // Now Alice turns HER OWN toggle off — she must lose the ability
      // to see Bob's (still-on) presence too, the other half of the
      // symmetric rule.
      await request(instanceA.getHttpServer())
        .patch('/v1/users/me/privacy')
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ showLastActiveStatus: false })
        .expect(200);
      const hiddenByAlice = await getBobPresence(alice.token, bob.userId);
      expect(hiddenByAlice).toBeNull();
    } finally {
      bobSocketOnB.disconnect();
    }
  }, 60000);
});
