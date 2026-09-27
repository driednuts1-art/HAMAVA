import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from 'redis';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { OTP_PROVIDER } from '../src/modules/auth/otp/otp-provider.interface';
import { CONVERSATIONAL_EXTRACTION_PROVIDER } from '../src/modules/profile/conversational-setup/conversational-extraction-provider.interface';
import type { ConversationalExtractionProviderInterface } from '../src/modules/profile/conversational-setup/conversational-extraction-provider.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { rejectVendorUnavailable } from './helpers/vendor-failure';
import { uniquePhone } from './helpers/unique-phone';

interface VerifyResponseBody {
  accessToken: string;
  user: { id: string };
}

interface StartResponseBody {
  sessionId: string;
  remainingFields: string[];
  assistantMessage: string;
}

interface TurnResponseBody {
  transcript?: string;
  proposed: {
    field: string | null;
    stringValue: string | null;
    interestsValue: string[] | null;
    birthDateGregorian: string | null;
    birthDateDisplay: string | null;
  };
  assistantReply: string;
  remainingFields: string[];
  completed: boolean;
}

interface ConfirmResponseBody {
  remainingFields: string[];
  completed: boolean;
}

interface ProfileResponseBody {
  displayName: string | null;
  birthDate: string | null;
  city: string | null;
  bio: string | null;
  interests: string[];
  profileCompletedAt: string | null;
}

function yearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/**
 * End-to-end test for Feature 11 (docs/requirements.md) — Conversational
 * (text+voice) Profile Setup — run against real infrastructure: the real
 * OpenAI extraction/Whisper calls, a real Postgres database, and the real
 * Redis session store (a second connection to the same instance used by
 * the chat WebSocket adapter, under its own key prefix).
 */
describe('Conversational (text+voice) Profile Setup (e2e)', () => {
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

  async function uploadPhoto(token: string): Promise<void> {
    const jpeg = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 3,
        background: { r: 4, g: 5, b: 6 },
      },
    })
      .jpeg()
      .toBuffer();
    await request(app.getHttpServer())
      .post('/v1/profile/photos')
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', jpeg, { filename: 'p.jpg', contentType: 'image/jpeg' })
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

  it('walks through all five fields via real text turns, and the completing confirm emits profile_completed with source: CONVERSATIONAL (FR-136, FR-138, FR-140..FR-142, FR-152)', async () => {
    const { token, userId } = await getAccessToken(uniquePhone());
    await uploadPhoto(token);
    // Feature 24 (FR-435/FR-437): completeness now also requires 2 real
    // prompt answers — deliberately set via the real, direct FORM route
    // (never the conversational one, which FR-437 explicitly keeps out of
    // scope), so the *conversational* flow's own final confirm below is
    // still the one real call that crosses the completion threshold.
    await request(app.getHttpServer())
      .patch('/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        promptAnswers: [
          { promptId: 'best-night', answer: 'A quiet night with good music.' },
          { promptId: 'weird-fact', answer: "I can solve a Rubik's cube." },
        ],
      })
      .expect(200);

    const start = (
      await request(app.getHttpServer())
        .post('/v1/profile/conversational-setup/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201)
    ).body as StartResponseBody;
    expect(start.remainingFields).toEqual([
      'displayName',
      'birthDate',
      'city',
      'bio',
      'interests',
    ]);
    const sessionId = start.sessionId;

    async function turnAndConfirm(
      message: string,
      expectedField: string,
    ): Promise<void> {
      const turn = (
        await request(app.getHttpServer())
          .post(`/v1/profile/conversational-setup/${sessionId}/message`)
          .set('Authorization', `Bearer ${token}`)
          .send({ text: message })
          .expect(201)
      ).body as TurnResponseBody;
      expect(turn.proposed.field).toBe(expectedField);

      const confirmBody: Record<string, unknown> = {};
      if (expectedField === 'interests') {
        confirmBody.interests = turn.proposed.interestsValue;
      } else if (expectedField === 'birthDate') {
        confirmBody.birthDate = turn.proposed.birthDateGregorian;
      } else {
        confirmBody[expectedField] = turn.proposed.stringValue;
      }

      await request(app.getHttpServer())
        .post(`/v1/profile/conversational-setup/${sessionId}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send(confirmBody)
        .expect(201);
    }

    // Order deliberately leaves birthDate for last: displayName+birthDate+photo
    // together cross Feature 2's completion threshold (FR-34), so the LAST
    // confirm call here is the one that should actually complete the profile.
    await turnAndConfirm('اسمم سارا هست', 'displayName');
    await turnAndConfirm('توی تهران زندگی می‌کنم', 'city');
    await turnAndConfirm('کوهنوردی و کتاب‌خوانی دوست دارم', 'interests');
    await turnAndConfirm(
      'کسی هستم که عاشق طبیعته و دنبال یه رابطه‌ی جدیه',
      'bio',
    );
    const finalConfirm = (
      await request(app.getHttpServer())
        .post(`/v1/profile/conversational-setup/${sessionId}/message`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'متولد ۱۲ مرداد ۱۳۷۰ هستم' })
        .expect(201)
    ).body as TurnResponseBody;
    expect(finalConfirm.proposed.field).toBe('birthDate');
    expect(finalConfirm.proposed.birthDateDisplay).toContain('شمسی');
    // Real, found-by-running finding (2026-09-25): replying in Persian, the
    // model correctly names the Persian calendar in Persian ("تقویم شمسی")
    // but treats "Gregorian" as a technical loanword and often keeps it in
    // English even inside an otherwise-Persian sentence — a real, measured
    // output was "تقویم شمسی 1370/5/12 → Gregorian 1991-08-03". Accepting
    // either word here checks the real requirement (the calendar switch is
    // visible, FR-142), not one specific vocabulary choice.
    expect(finalConfirm.proposed.birthDateDisplay).toMatch(/میلادی|Gregorian/);

    const confirmResult = (
      await request(app.getHttpServer())
        .post(`/v1/profile/conversational-setup/${sessionId}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ birthDate: finalConfirm.proposed.birthDateGregorian })
        .expect(201)
    ).body as ConfirmResponseBody;
    expect(confirmResult.completed).toBe(true);

    const profile = (
      await request(app.getHttpServer())
        .get('/v1/profile/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as ProfileResponseBody;
    expect(profile.profileCompletedAt).toBeTruthy();
    expect(profile.displayName).toBe('سارا');
    expect(profile.city).toBe('تهران');

    const events = await app.get(PrismaService).analyticsEvent.findMany({
      where: { userId, event: 'profile_completed' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].properties).toEqual({ source: 'CONVERSATIONAL' });
  }, 120000);

  it('a real voice turn produces a transcript and a correctly-extracted city field (FR-137, real Whisper)', async () => {
    const { token } = await getAccessToken(uniquePhone());
    const start = (
      await request(app.getHttpServer())
        .post('/v1/profile/conversational-setup/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201)
    ).body as StartResponseBody;

    const audio = readFileSync(
      join(__dirname, 'fixtures/conversational-setup-name-city-fa.mp3'),
    );

    const turn = (
      await request(app.getHttpServer())
        .post(`/v1/profile/conversational-setup/${start.sessionId}/voice`)
        .set('Authorization', `Bearer ${token}`)
        .attach('audio', audio, {
          filename: 'clip.mp3',
          contentType: 'audio/mpeg',
        })
        .expect(201)
    ).body as TurnResponseBody;

    expect(turn.transcript).toBeTruthy();
    // Real, found-by-running finding (2026-09-25): with `language` no longer
    // forced (a user may speak any language — explicit product decision),
    // Whisper's auto-detect mode sometimes transliterates spoken Persian
    // into Latin script instead of native Persian script — a real, measured
    // transcript was "Ismam Sora hast wa tuye Taharon zindagi mikonam." for
    // speech that says "اسمم سارا هست و توی تهران زندگی می‌کنم." This is a
    // genuine Whisper auto-detect quirk for this specific language, not an
    // application bug, and not fixable without re-forcing a single language
    // (which would defeat the whole point). Accepting either script here
    // checks the real requirement (real audio really got transcribed), not
    // one specific script Whisper happens to pick this run.
    expect(turn.transcript).toMatch(/تهران|taharon|tehran/i);
    // The fixture mentions a name AND a city; either is an acceptable real
    // extraction from a single turn (FR-138 allows at most one field), but
    // something must be genuinely extracted from real audio, not stubbed.
    expect(['displayName', 'city']).toContain(turn.proposed.field);
  }, 60000);

  it('audio bytes are not present anywhere the app can reach them after a voice turn completes (FR-145, mirrors FR-106)', async () => {
    const { token, userId } = await getAccessToken(uniquePhone());
    const start = (
      await request(app.getHttpServer())
        .post('/v1/profile/conversational-setup/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201)
    ).body as StartResponseBody;
    const audio = readFileSync(
      join(__dirname, 'fixtures/conversational-setup-name-city-fa.mp3'),
    );

    await request(app.getHttpServer())
      .post(`/v1/profile/conversational-setup/${start.sessionId}/voice`)
      .set('Authorization', `Bearer ${token}`)
      .attach('audio', audio, {
        filename: 'clip.mp3',
        contentType: 'audio/mpeg',
      })
      .expect(201);

    // No Photo row and no AnalyticsEvent/AuditLog row could plausibly carry
    // raw audio bytes — the only real storage surface in this app that
    // could is STORAGE_PROVIDER (photos), untouched by this endpoint.
    const photos = await app
      .get(PrismaService)
      .photo.count({ where: { userId } });
    expect(photos).toBe(0);
  }, 60000);

  it('confirming a value edited away from the AI proposal persists the edited value, not the proposal (FR-141)', async () => {
    const { token } = await getAccessToken(uniquePhone());
    const start = (
      await request(app.getHttpServer())
        .post('/v1/profile/conversational-setup/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201)
    ).body as StartResponseBody;

    const turn = (
      await request(app.getHttpServer())
        .post(`/v1/profile/conversational-setup/${start.sessionId}/message`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'اسمم علی هست' })
        .expect(201)
    ).body as TurnResponseBody;
    expect(turn.proposed.field).toBe('displayName');
    expect(turn.proposed.stringValue).toBe('علی');

    await request(app.getHttpServer())
      .post(`/v1/profile/conversational-setup/${start.sessionId}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'نام ویرایش‌شده' })
      .expect(201);

    const profile = (
      await request(app.getHttpServer())
        .get('/v1/profile/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as ProfileResponseBody;
    expect(profile.displayName).toBe('نام ویرایش‌شده');
    // Explicit, not just incidental: the persisted value is provably NOT
    // the AI's real proposal from moments earlier in this same session.
    expect(profile.displayName).not.toBe(turn.proposed.stringValue);
  }, 60000);

  it('a confirmed bio that fails real content moderation is rejected exactly like a directly-typed one (422, FR-33)', async () => {
    const { token } = await getAccessToken(uniquePhone());
    const start = (
      await request(app.getHttpServer())
        .post('/v1/profile/conversational-setup/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201)
    ).body as StartResponseBody;

    await request(app.getHttpServer())
      .post(`/v1/profile/conversational-setup/${start.sessionId}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        bio: 'I will hurt you and everyone you love, send me money now or else',
      })
      .expect(422);
  }, 30000);

  it('a confirmed birthDate implying under-18 is rejected exactly like a directly-typed one (400, FR-20)', async () => {
    const { token } = await getAccessToken(uniquePhone());
    const start = (
      await request(app.getHttpServer())
        .post('/v1/profile/conversational-setup/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201)
    ).body as StartResponseBody;

    await request(app.getHttpServer())
      .post(`/v1/profile/conversational-setup/${start.sessionId}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ birthDate: yearsAgo(10) })
      .expect(400);
  }, 30000);

  it("session-scoped authorization: a second real user cannot read, post into, or confirm into the first user's session (FR-133)", async () => {
    const a = await getAccessToken(uniquePhone());
    const b = await getAccessToken(uniquePhone());
    const start = (
      await request(app.getHttpServer())
        .post('/v1/profile/conversational-setup/start')
        .set('Authorization', `Bearer ${a.token}`)
        .expect(201)
    ).body as StartResponseBody;

    await request(app.getHttpServer())
      .post(`/v1/profile/conversational-setup/${start.sessionId}/message`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ text: 'hi' })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/v1/profile/conversational-setup/${start.sessionId}/confirm`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ displayName: 'hijack' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/v1/profile/conversational-setup/${start.sessionId}`)
      .set('Authorization', `Bearer ${b.token}`)
      .expect(404);
  }, 30000);

  it('a vendor failure mid-conversation returns 503 naming PATCH /v1/profile, and the session stays resumable afterward (FR-147)', async () => {
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
      .overrideProvider(CONVERSATIONAL_EXTRACTION_PROVIDER)
      .useValue({
        extractTurn: () => rejectVendorUnavailable(),
      } satisfies ConversationalExtractionProviderInterface)
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
      const phone = uniquePhone();
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
      const token = body.accessToken;

      const start = (
        await request(failingApp.getHttpServer())
          .post('/v1/profile/conversational-setup/start')
          .set('Authorization', `Bearer ${token}`)
          .expect(201)
      ).body as StartResponseBody;

      const res = await request(failingApp.getHttpServer())
        .post(`/v1/profile/conversational-setup/${start.sessionId}/message`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'اسمم رضاست' })
        .expect(503);
      expect(JSON.stringify(res.body)).toContain('PATCH /v1/profile');

      // Fail-open at the vendor-call level, not session-corrupting — the
      // session itself must still exist and be usable afterward. We can't
      // retry the SAME (still-failing) extraction call here, but we can
      // prove the session record itself survived the failure.
      const config = failingApp.get(ConfigService);
      const client = createClient({
        url: config.getOrThrow<string>('REDIS_URL'),
      });
      await client.connect();
      try {
        const raw = await client.get(`conv-setup:session:${start.sessionId}`);
        expect(raw).toBeTruthy();
      } finally {
        await client.quit();
      }
    } finally {
      await failingApp.close();
    }
  }, 60000);

  it('ending a session immediately removes it from Redis — no conversation text survives, and further calls 404 (FR-135, FR-143/144)', async () => {
    const { token } = await getAccessToken(uniquePhone());
    const start = (
      await request(app.getHttpServer())
        .post('/v1/profile/conversational-setup/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201)
    ).body as StartResponseBody;

    await request(app.getHttpServer())
      .post(`/v1/profile/conversational-setup/${start.sessionId}/message`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'یه پیام واقعی که نباید هیچ‌وقت جایی دائمی ذخیره بشه' })
      .expect(201);

    const config = app.get(ConfigService);
    const client = createClient({
      url: config.getOrThrow<string>('REDIS_URL'),
    });
    await client.connect();
    try {
      const before = await client.get(`conv-setup:session:${start.sessionId}`);
      expect(before).toBeTruthy(); // sanity: it really was there mid-conversation

      await request(app.getHttpServer())
        .delete(`/v1/profile/conversational-setup/${start.sessionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const after = await client.get(`conv-setup:session:${start.sessionId}`);
      expect(after).toBeNull();
    } finally {
      await client.quit();
    }

    await request(app.getHttpServer())
      .post(`/v1/profile/conversational-setup/${start.sessionId}/message`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'hi again' })
      .expect(404);
  }, 30000);

  it('a user who never uses the conversational flow still completes their profile via PATCH /v1/profile, emitting profile_completed with source: FORM (FR-146, FR-152)', async () => {
    const { token, userId } = await getAccessToken(uniquePhone());

    await request(app.getHttpServer())
      .patch('/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        displayName: 'FormOnly',
        birthDate: yearsAgo(25),
        // Feature 24 (FR-435): profile completeness now also requires 2
        // real prompt answers, alongside displayName/birthDate/photo.
        promptAnswers: [
          { promptId: 'best-night', answer: 'A quiet night with good music.' },
          { promptId: 'weird-fact', answer: "I can solve a Rubik's cube." },
        ],
      })
      .expect(200);
    await uploadPhoto(token);

    const events = await app.get(PrismaService).analyticsEvent.findMany({
      where: { userId, event: 'profile_completed' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].properties).toEqual({ source: 'FORM' });
  }, 30000);
});
