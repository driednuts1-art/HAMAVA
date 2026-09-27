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
import { STORAGE_PROVIDER } from '../src/modules/profile/storage/storage-provider.interface';
import type { StorageProviderInterface } from '../src/modules/profile/storage/storage-provider.interface';
import { uniquePhone } from './helpers/unique-phone';
import { fetchFullDeck } from './helpers/paginate-to-exhaustion';

interface VerifyResponseBody {
  accessToken: string;
  user: { id: string };
}

interface SettingsResponseBody {
  preciseLocationEnabled: boolean;
  messagingPermission: string;
  notifyOnNewMatch: boolean;
  notifyOnNewMessage: boolean;
  notifyOnSafetyAlert: boolean;
}

interface DeckCandidate {
  id: string;
}

interface DeckResponseBody {
  candidates: DeckCandidate[];
}

/**
 * End-to-end test for Core Settings (docs/requirements.md Feature 6), run
 * against real Postgres. Covers: secure-by-default privacy settings, real
 * enforcement of messagingPermission in the deck (not just storage), and a
 * real, complete account-deletion purge — including that a stolen access
 * token alone cannot trigger it, and that the physical photo file, not just
 * the DB row, is actually gone afterward.
 */
describe('Core Settings (e2e)', () => {
  let app: INestApplication<App>;
  let capturedCode: string;
  const createdUserIds: string[] = [];

  async function getAccessToken(
    phone: string,
  ): Promise<{ token: string; userId: string; refreshToken: string }> {
    await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone })
      .expect(202);
    const verifyRes = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ phone, code: capturedCode })
      .expect(200);
    const body = verifyRes.body as VerifyResponseBody & {
      refreshToken: string;
    };
    createdUserIds.push(body.user.id);
    return {
      token: body.accessToken,
      userId: body.user.id,
      refreshToken: body.refreshToken,
    };
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

  it('gives a brand-new user secure-by-default privacy settings without ever calling PATCH (FR-78)', async () => {
    const user = await getAccessToken(uniquePhone());

    const res = await request(app.getHttpServer())
      .get('/v1/users/me/settings')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const settings = res.body as SettingsResponseBody;

    expect(settings.preciseLocationEnabled).toBe(false);
    expect(settings.messagingPermission).toBe('VERIFIED_ONLY');
    expect(settings.notifyOnNewMatch).toBe(true);
    expect(settings.notifyOnNewMessage).toBe(true);
    expect(settings.notifyOnSafetyAlert).toBe(true);
  });

  it('persists a partial privacy/notification update without disturbing other fields (FR-80, FR-81)', async () => {
    const user = await getAccessToken(uniquePhone());
    const auth = `Bearer ${user.token}`;

    await request(app.getHttpServer())
      .patch('/v1/users/me/privacy')
      .set('Authorization', auth)
      .send({ preciseLocationEnabled: true })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/v1/users/me/notifications')
      .set('Authorization', auth)
      .send({ notifyOnNewMessage: false })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/v1/users/me/settings')
      .set('Authorization', auth)
      .expect(200);
    const settings = res.body as SettingsResponseBody;

    expect(settings.preciseLocationEnabled).toBe(true);
    expect(settings.messagingPermission).toBe('VERIFIED_ONLY'); // untouched
    expect(settings.notifyOnNewMessage).toBe(false);
    expect(settings.notifyOnNewMatch).toBe(true); // untouched
    expect(settings.notifyOnSafetyAlert).toBe(true); // untouched
  });

  it("excludes a VERIFIED_ONLY candidate from an unverified viewer's deck, and re-includes it when set to EVERYONE (FR-79)", async () => {
    const viewer = await getAccessToken(uniquePhone()); // stays unverified
    const candidate = await getAccessToken(uniquePhone());
    await buildVerifiedProfile(candidate.token, 'CS-Candidate');

    const deckBefore = (
      await request(app.getHttpServer())
        .get('/v1/discovery/deck?limit=50')
        .set('Authorization', `Bearer ${viewer.token}`)
        .expect(200)
    ).body as DeckResponseBody;
    // Default messagingPermission is VERIFIED_ONLY, and the viewer is unverified.
    expect(deckBefore.candidates.map((c) => c.id)).not.toContain(
      candidate.userId,
    );

    await request(app.getHttpServer())
      .patch('/v1/users/me/privacy')
      .set('Authorization', `Bearer ${candidate.token}`)
      .send({ messagingPermission: 'EVERYONE' })
      .expect(200);

    // Paginated to exhaustion, not a single-page snapshot — the real dev DB
    // never resets between e2e runs and keeps growing, so a brand-new
    // candidate can legitimately sort past a single page; see
    // test/helpers/paginate-to-exhaustion.ts.
    const deckAfterCandidates = await fetchFullDeck<DeckCandidate>(
      app.getHttpServer(),
      viewer.token,
    );
    expect(deckAfterCandidates.map((c) => c.id)).toContain(candidate.userId);
  });

  it("rejects account deletion without a valid, fresh OTP for the caller's own phone (FR-83)", async () => {
    const phone = uniquePhone();
    const user = await getAccessToken(phone);
    const auth = `Bearer ${user.token}`;

    // No OTP requested at all — a stale/made-up code.
    await request(app.getHttpServer())
      .delete('/v1/users/me')
      .set('Authorization', auth)
      .send({ phone, code: '000000' })
      .expect(401);

    // A valid OTP, but for a *different* phone number (not this account's own).
    const otherPhone = uniquePhone();
    await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone: otherPhone })
      .expect(202);
    const otherCode = capturedCode;
    await request(app.getHttpServer())
      .delete('/v1/users/me')
      .set('Authorization', auth)
      .send({ phone: otherPhone, code: otherCode })
      .expect(401);

    // The account must still exist after both rejected attempts.
    const stillExists = await app
      .get(PrismaService)
      .user.findUnique({ where: { id: user.userId } });
    expect(stillExists).not.toBeNull();
  });

  it('performs a real, complete purge on confirmed deletion: photo file gone from disk, DB rows cascaded, AuditLog survives, phone reusable (FR-83..FR-86)', async () => {
    const phone = uniquePhone();
    const user = await getAccessToken(phone);
    await buildVerifiedProfile(user.token, 'CS-ToDelete');
    const auth = `Bearer ${user.token}`;

    const prisma = app.get(PrismaService);
    const storage = app.get<StorageProviderInterface>(STORAGE_PROVIDER);

    const photoRow = await prisma.photo.findFirstOrThrow({
      where: { userId: user.userId },
    });
    await expect(storage.read(photoRow.storageKey)).resolves.toBeInstanceOf(
      Buffer,
    );

    await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone })
      .expect(202);
    const code = capturedCode;

    await request(app.getHttpServer())
      .delete('/v1/users/me')
      .set('Authorization', auth)
      .send({ phone, code })
      .expect(204);

    // DB row gone.
    await expect(
      prisma.user.findUnique({ where: { id: user.userId } }),
    ).resolves.toBeNull();
    // Physical file gone, not just the DB row.
    await expect(storage.read(photoRow.storageKey)).rejects.toThrow();
    // AuditLog survives — no FK to User, by design.
    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        action: 'ACCOUNT_DELETION_REQUESTED',
        actorId: user.userId,
      },
    });
    expect(auditEntry).not.toBeNull();

    // The phone number is immediately reusable for a brand-new account.
    await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone })
      .expect(202);
    const reuseVerify = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ phone, code: capturedCode })
      .expect(200);
    const newUser = (reuseVerify.body as VerifyResponseBody).user;
    expect(newUser.id).not.toBe(user.userId);
    createdUserIds.push(newUser.id);
  }, 30000);

  /**
   * Feature 20 pre-implementation finding, confirmed directly against the
   * real running backend before any fix existed: a real access token is a
   * self-contained signed claim, and the guard that verified it never
   * checked whether the user it names still exists. A still-unexpired
   * token for a just-deleted account passed JwtAuthGuard exactly as if the
   * account were real, and SettingsService's `findUniqueOrThrow` then threw
   * an uncaught Prisma P2025 — a real 500, not a real 401/403. Fixed by
   * JwtAuthGuard re-checking real existence on every request (the one place
   * that protects every authenticated endpoint uniformly), plus a defense-
   * in-depth P2025→404 branch added to ProblemDetailsFilter for any other
   * real "record not found" site that might still let one through
   * uncaught. This test is the real, direct proof the fix works — not
   * reasoning about the guard's code alone.
   */
  it("rejects the caller's own now-stale access token on a protected endpoint after a real account deletion — a real 401, not the real 500 this produced before the JwtAuthGuard fix", async () => {
    const phone = uniquePhone();
    const user = await getAccessToken(phone);
    const staleAuth = `Bearer ${user.token}`;

    await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone })
      .expect(202);
    const code = capturedCode;

    await request(app.getHttpServer())
      .delete('/v1/users/me')
      .set('Authorization', staleAuth)
      .send({ phone, code })
      .expect(204);

    const res = await request(app.getHttpServer())
      .get('/v1/users/me/settings')
      .set('Authorization', staleAuth);
    expect(res.status).toBe(401);
  }, 30000);

  it('still logs out and revokes exactly the current refresh token (FR-87, unchanged from Feature 1)', async () => {
    const user = await getAccessToken(uniquePhone());

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .send({ refreshToken: user.refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
  });
});
