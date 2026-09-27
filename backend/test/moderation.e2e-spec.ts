import {
  INestApplication,
  ServiceUnavailableException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import sharp from 'sharp';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { OTP_PROVIDER } from '../src/modules/auth/otp/otp-provider.interface';
import { CONTENT_MODERATION_PROVIDER } from '../src/common/moderation/content-moderation-provider.interface';
import type { ContentModerationProviderInterface } from '../src/common/moderation/content-moderation-provider.interface';
import { STORAGE_PROVIDER } from '../src/modules/profile/storage/storage-provider.interface';
import type { StorageProviderInterface } from '../src/modules/profile/storage/storage-provider.interface';
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

interface ModerationFlagResponse {
  id: string;
  contentType: string;
  status: string;
  quarantineUrl: string | null;
}

const THREATENING_TEXT =
  'I will find you and kill you, you worthless piece of garbage.';

async function bootstrapApp(
  moderationOverride?: ContentModerationProviderInterface,
): Promise<{ app: INestApplication<App>; capturedCode: { value: string } }> {
  const capturedCode = { value: '' };
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OTP_PROVIDER)
    .useValue({
      sendOtp: (_phone: string, code: string) => {
        capturedCode.value = code;
        return Promise.resolve();
      },
    });

  if (moderationOverride) {
    builder = builder
      .overrideProvider(CONTENT_MODERATION_PROVIDER)
      .useValue(moderationOverride);
  }

  const moduleFixture: TestingModule = await builder.compile();
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
  return { app, capturedCode };
}

/**
 * End-to-end test for Real Content Moderation (docs/requirements.md
 * Feature 8). Text rejection uses the real OpenAI Moderation API,
 * unmodified — genuinely threatening text reliably triggers it, verified
 * directly beforehand (see conversation history). Photo rejection and the
 * fail-closed path use a substituted provider instead of trying to force a
 * real vision classifier to flag a synthetic test image (unreliable and,
 * for the nudity/violence categories specifically, inappropriate to embed
 * as a test fixture) — everything *around* the verdict (quarantine writes
 * to real MinIO, DB rows, the admin review surface) is still exercised for
 * real; only the moderation verdict itself is substituted for determinism.
 */
describe('Real Content Moderation (e2e)', () => {
  describe('real OpenAI vendor — text rejection + admin review', () => {
    let app: INestApplication<App>;
    let capturedCode: { value: string };
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
        .send({ phone, code: capturedCode.value })
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
      const result = await bootstrapApp();
      app = result.app;
      capturedCode = result.capturedCode;
    });

    afterAll(async () => {
      if (createdUserIds.length > 0) {
        await app
          .get(PrismaService)
          .user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      await app.close();
    });

    it('rejects a genuinely threatening bio via the real vendor, and retains it as a ModerationFlag (FR-96, FR-97)', async () => {
      const user = await getAccessToken(uniquePhone());

      await request(app.getHttpServer())
        .patch('/v1/profile')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ bio: THREATENING_TEXT })
        .expect(422);

      const prisma = app.get(PrismaService);
      const flag = await prisma.moderationFlag.findFirst({
        where: { userId: user.userId, contentType: 'BIO_TEXT' },
      });
      expect(flag).not.toBeNull();
      expect(flag?.textContent).toBe(THREATENING_TEXT);
      expect(flag?.status).toBe('PENDING_REVIEW');
      expect(flag?.reason).toContain('harassment');
    });

    it('rejects a genuinely threatening message via the real vendor, retained with contextRef=matchId', async () => {
      const alice = await getAccessToken(uniquePhone());
      const bob = await getAccessToken(uniquePhone());
      await buildVerifiedProfile(alice.token, 'CM-Alice');
      await buildVerifiedProfile(bob.token, 'CM-Bob');
      const matchId = await createMatch(
        alice.token,
        alice.userId,
        bob.token,
        bob.userId,
      );

      await request(app.getHttpServer())
        .post(`/v1/chat/conversations/${matchId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ content: THREATENING_TEXT, clientIdempotencyKey: randomUUID() })
        .expect(422);

      const prisma = app.get(PrismaService);
      const flag = await prisma.moderationFlag.findFirst({
        where: { userId: alice.userId, contentType: 'MESSAGE' },
      });
      expect(flag).not.toBeNull();
      expect(flag?.textContent).toBe(THREATENING_TEXT);
      expect(flag?.contextRef).toBe(matchId);
    });

    it('gates the moderation-flag queue behind ADMIN, and supports listing + resolving (FR-98, FR-99)', async () => {
      const admin = await getAccessToken(uniquePhone());
      const nonAdmin = await getAccessToken(uniquePhone());

      await request(app.getHttpServer())
        .get('/v1/admin/moderation-flags')
        .set('Authorization', `Bearer ${nonAdmin.token}`)
        .expect(403);

      await app.get(PrismaService).user.update({
        where: { id: admin.userId },
        data: { role: UserRole.ADMIN },
      });

      const listRes = await request(app.getHttpServer())
        .get('/v1/admin/moderation-flags?status=PENDING_REVIEW&limit=100')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      const listed = (listRes.body as { flags: ModerationFlagResponse[] })
        .flags;
      expect(listed.length).toBeGreaterThan(0);
      const flagId = listed[0].id;

      const resolveRes = await request(app.getHttpServer())
        .patch(`/v1/admin/moderation-flags/${flagId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ resolution: 'UPHELD', resolutionNote: 'confirmed harassment' })
        .expect(200);
      expect((resolveRes.body as ModerationFlagResponse).status).toBe(
        'RESOLVED',
      );

      const auditEntry = await app.get(PrismaService).auditLog.findFirst({
        where: { action: 'MODERATION_FLAG_RESOLVED', targetRef: flagId },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry?.actorId).toBe(admin.userId);
    });
  });

  describe('photo rejection → quarantine (real MinIO, substituted verdict)', () => {
    let app: INestApplication<App>;
    let capturedCode: { value: string };
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      const result = await bootstrapApp({
        moderateText: () => Promise.resolve({ approved: true }),
        moderateImage: () =>
          Promise.resolve({
            approved: false,
            reason: 'test-triggered-rejection',
          }),
      });
      app = result.app;
      capturedCode = result.capturedCode;
    });

    afterAll(async () => {
      if (createdUserIds.length > 0) {
        await app
          .get(PrismaService)
          .user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      await app.close();
    });

    it('quarantines the flagged image in real storage, retrievable via a real presigned URL (FR-97)', async () => {
      const phone = uniquePhone();
      await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone })
        .expect(202);
      const verifyRes = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ phone, code: capturedCode.value })
        .expect(200);
      const user = (verifyRes.body as VerifyResponseBody).user;
      createdUserIds.push(user.id);
      const token = (verifyRes.body as VerifyResponseBody).accessToken;

      const jpeg = await sharp({
        create: {
          width: 20,
          height: 20,
          channels: 3,
          background: { r: 1, g: 2, b: 3 },
        },
      })
        .jpeg()
        .toBuffer();

      await request(app.getHttpServer())
        .post('/v1/profile/photos')
        .set('Authorization', `Bearer ${token}`)
        .attach('photo', jpeg, { filename: 'p.jpg', contentType: 'image/jpeg' })
        .expect(422);

      const prisma = app.get(PrismaService);
      const flag = await prisma.moderationFlag.findFirst({
        where: { userId: user.id, contentType: 'PHOTO' },
      });
      expect(flag).not.toBeNull();
      expect(flag?.quarantineStorageKey).toMatch(/^flagged\//);
      expect(flag?.reason).toBe('test-triggered-rejection');

      const storage = app.get<StorageProviderInterface>(STORAGE_PROVIDER);
      const url = await storage.getUrl(flag!.quarantineStorageKey!);
      const fetchRes = await fetch(url);
      expect(fetchRes.status).toBe(200);
    });
  });

  describe('fail-closed on vendor error (substituted provider)', () => {
    let app: INestApplication<App>;
    let capturedCode: { value: string };
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      const result = await bootstrapApp({
        moderateText: () =>
          Promise.reject(
            new ServiceUnavailableException('simulated vendor outage'),
          ),
        moderateImage: () =>
          Promise.reject(
            new ServiceUnavailableException('simulated vendor outage'),
          ),
      });
      app = result.app;
      capturedCode = result.capturedCode;
    });

    afterAll(async () => {
      if (createdUserIds.length > 0) {
        await app
          .get(PrismaService)
          .user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      await app.close();
    });

    it('rejects with 503, not a silent approval, when the vendor is unreachable (FR-100)', async () => {
      const phone = uniquePhone();
      await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone })
        .expect(202);
      const verifyRes = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ phone, code: capturedCode.value })
        .expect(200);
      const user = (verifyRes.body as VerifyResponseBody).user;
      createdUserIds.push(user.id);
      const token = (verifyRes.body as VerifyResponseBody).accessToken;

      await request(app.getHttpServer())
        .patch('/v1/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ bio: 'this would normally be a perfectly fine bio' })
        .expect(503);
    });
  });
});
