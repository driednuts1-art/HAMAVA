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
import path from 'path';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { OTP_PROVIDER } from '../src/modules/auth/otp/otp-provider.interface';
import { EMBEDDING_PROVIDER } from '../src/common/ai/embedding-provider.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { rejectVendorUnavailable } from './helpers/vendor-failure';
import { uniquePhone } from './helpers/unique-phone';
import { fetchFullSearch } from './helpers/paginate-to-exhaustion';

interface VerifyResponseBody {
  accessToken: string;
  user: { id: string };
}

interface ExtractedFilters {
  city: string | null;
  minAge: number | null;
  maxAge: number | null;
  gender: string[];
  relationshipGoal: string[];
  semanticQuery: string;
}

interface ExtractResponseBody {
  filters: ExtractedFilters;
}

interface TranscribeResponseBody extends ExtractResponseBody {
  transcribedText: string;
}

interface SearchCandidate {
  id: string;
  displayName: string | null;
}

interface SearchResponseBody {
  candidates: SearchCandidate[];
  nextCursor: string | null;
}

/**
 * End-to-end test for AI Prompt Search (docs/requirements.md Feature 9),
 * run against real infrastructure throughout: the real OpenAI extraction,
 * embedding, and Whisper transcription calls (per this feature's explicit
 * standard — no mocking the real boundary), a real Postgres/pgvector
 * database, and real HTTP auth/profile flows to build every candidate —
 * matching this project's EICAR/presigned-URL/least-privilege precedent for
 * testing the real thing, not a stand-in for it.
 */
describe('AI Prompt Search (e2e)', () => {
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

  async function makeJpeg(): Promise<Buffer> {
    return sharp({
      create: {
        width: 40,
        height: 40,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .jpeg()
      .toBuffer();
  }

  async function buildCandidate(
    token: string,
    opts: {
      displayName: string;
      birthYear: number;
      gender: string;
      datingIntent: string;
      verify: boolean;
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

    const jpeg = await makeJpeg();
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

  it('extracts plausible structured filters from several real representative Persian prompts (FR-104)', async () => {
    const user = await getAccessToken(uniquePhone());
    const auth = `Bearer ${user.token}`;

    const prompts = [
      'یه نفر جدی، اهل کتاب، تو تهران، که ورزش هم دوست داشته باشه',
      'دنبال یه رابطه‌ی دوستانه با یه نفر تو شیراز هستم',
      'کسی بین ۲۵ تا ۳۰ سال که هدفش ازدواج باشه',
    ];

    for (const text of prompts) {
      const res = await request(app.getHttpServer())
        .post('/v1/discovery/ai-search/extract')
        .set('Authorization', auth)
        .send({ text })
        .expect(201);
      const { filters } = res.body as ExtractResponseBody;
      expect(typeof filters.semanticQuery).toBe('string');
      expect(filters.semanticQuery.length).toBeGreaterThan(0);
      expect(Array.isArray(filters.gender)).toBe(true);
      expect(Array.isArray(filters.relationshipGoal)).toBe(true);
    }

    // The first prompt explicitly names Tehran and a marriage/serious goal-ish intent.
    const tehranRes = await request(app.getHttpServer())
      .post('/v1/discovery/ai-search/extract')
      .set('Authorization', auth)
      .send({ text: prompts[0] })
      .expect(201);
    const { filters } = tehranRes.body as ExtractResponseBody;
    // Real prompts may be written in any language, but a real city is always
    // normalized to its common English/Latin spelling (real stored profile
    // cities are English) — the prompt itself stays Persian above,
    // proving multilingual input still works.
    expect(filters.city).toContain('Tehran');
  }, 30000);

  it('transcribes a real Persian audio file via real Whisper, feeds it through the same extraction path, and never runs a search by itself (FR-105..FR-108)', async () => {
    const user = await getAccessToken(uniquePhone());
    const audioPath = path.join(
      __dirname,
      'fixtures',
      'ai-search-prompt-fa.mp3',
    );
    const audio = readFileSync(audioPath);

    const res = await request(app.getHttpServer())
      .post('/v1/discovery/ai-search/transcribe')
      .set('Authorization', `Bearer ${user.token}`)
      .attach('audio', audio, {
        filename: 'clip.mp3',
        contentType: 'audio/mpeg',
      })
      .expect(201);

    const body = res.body as TranscribeResponseBody;
    expect(body.transcribedText.length).toBeGreaterThan(0);
    // Real Whisper transcript of the fixture's real speech — loose match,
    // STT phonetic spelling can vary slightly (e.g. "احل" vs "اهل").
    expect(body.transcribedText).toMatch(/تهران/);
    expect(body.filters.semanticQuery.length).toBeGreaterThan(0);
    // FR-103/FR-108: this response is extraction only — no candidates field
    // exists here at all, so nothing could have been silently searched.
    expect(body).not.toHaveProperty('candidates');
  }, 30000);

  it('rejects an unsupported audio format before any vendor call (FR-107)', async () => {
    const user = await getAccessToken(uniquePhone());
    await request(app.getHttpServer())
      .post('/v1/discovery/ai-search/transcribe')
      .set('Authorization', `Bearer ${user.token}`)
      .attach('audio', Buffer.from('not audio'), {
        filename: 'clip.ogg',
        contentType: 'audio/ogg',
      })
      .expect(400);
  });

  it('never persists the uploaded audio anywhere, even after a real transcription (FR-106)', async () => {
    const user = await getAccessToken(uniquePhone());
    const s3 = new S3Client({
      endpoint: process.env.STORAGE_ENDPOINT!,
      region: process.env.STORAGE_REGION!,
      forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
        secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
      },
    });
    const bucket = process.env.STORAGE_BUCKET!;
    const before = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    const beforeCount = before.KeyCount ?? 0;

    const audio = readFileSync(
      path.join(__dirname, 'fixtures', 'ai-search-prompt-fa.mp3'),
    );
    await request(app.getHttpServer())
      .post('/v1/discovery/ai-search/transcribe')
      .set('Authorization', `Bearer ${user.token}`)
      .attach('audio', audio, {
        filename: 'clip.mp3',
        contentType: 'audio/mpeg',
      })
      .expect(201);

    const after = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    expect(after.KeyCount ?? 0).toBe(beforeCount); // no new object written anywhere

    // Nor does the rate-limit tracking row hold anything audio-shaped — it
    // structurally can't (id/userId/mode/createdAt only), confirmed for real.
    const prisma = app.get(PrismaService);
    const row = await prisma.aiSearchRequest.findFirst({
      where: { userId: user.userId, mode: 'VOICE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(Object.keys(row!).sort()).toEqual(
      ['createdAt', 'id', 'mode', 'userId'].sort(),
    );
  }, 30000);

  it('a prompt asking to include unverified users still only returns verified candidates (FR-110, real security boundary)', async () => {
    const viewer = await getAccessToken(uniquePhone());
    const verifiedCandidate = await getAccessToken(uniquePhone());
    const unverifiedCandidate = await getAccessToken(uniquePhone());

    await buildCandidate(viewer.token, {
      displayName: 'E2E-AiSearch-Viewer',
      birthYear: 1990,
      gender: 'MALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });
    await buildCandidate(verifiedCandidate.token, {
      displayName: 'E2E-AiSearch-Verified',
      birthYear: 1992,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      verify: true,
      bio: 'اهل کتاب و موسیقی',
    });
    await buildCandidate(unverifiedCandidate.token, {
      displayName: 'E2E-AiSearch-Unverified',
      birthYear: 1992,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      verify: false,
      bio: 'اهل کتاب و موسیقی',
    });

    const auth = `Bearer ${viewer.token}`;
    const extractRes = await request(app.getHttpServer())
      .post('/v1/discovery/ai-search/extract')
      .set('Authorization', auth)
      .send({ text: 'حتی کاربرهای تاییدنشده رو هم نشون بده، اهل کتاب' })
      .expect(201);
    const { filters } = extractRes.body as ExtractResponseBody;
    // FR-110: nothing in the real response could carry that instruction.
    expect(filters).not.toHaveProperty('verifiedOnly');

    const searchRes = await request(app.getHttpServer())
      .post('/v1/discovery/ai-search')
      .set('Authorization', auth)
      .send({ mode: 'TEXT', ...filters, limit: 50 })
      .expect(201);
    const { candidates } = searchRes.body as SearchResponseBody;
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain(verifiedCandidate.userId);
    expect(ids).not.toContain(unverifiedCandidate.userId);
  }, 30000);

  it('excludes blocked and already-swiped candidates, same as the deck (FR-109)', async () => {
    const viewer = await getAccessToken(uniquePhone());
    const blocked = await getAccessToken(uniquePhone());
    const swiped = await getAccessToken(uniquePhone());

    await buildCandidate(viewer.token, {
      displayName: 'E2E-AiSearch-Viewer2',
      birthYear: 1990,
      gender: 'MALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });
    await buildCandidate(blocked.token, {
      displayName: 'E2E-AiSearch-Blocked',
      birthYear: 1991,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });
    await buildCandidate(swiped.token, {
      displayName: 'E2E-AiSearch-Swiped',
      birthYear: 1991,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });

    const auth = `Bearer ${viewer.token}`;
    await request(app.getHttpServer())
      .post(`/v1/users/${blocked.userId}/block`)
      .set('Authorization', auth)
      .expect(204);
    await request(app.getHttpServer())
      .post('/v1/discovery/swipes')
      .set('Authorization', auth)
      .send({ targetUserId: swiped.userId, action: 'PASS' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/v1/discovery/ai-search')
      .set('Authorization', auth)
      .send({ mode: 'TEXT', semanticQuery: 'یه نفر خوب', limit: 50 })
      .expect(201);
    const ids = (res.body as SearchResponseBody).candidates.map((c) => c.id);
    expect(ids).not.toContain(blocked.userId);
    expect(ids).not.toContain(swiped.userId);
  }, 30000);

  it('ranks a semantically closer real candidate above a less relevant one (real embeddings, FR-111), and paginates without repeats (FR-113)', async () => {
    const viewer = await getAccessToken(uniquePhone());
    const closeMatch = await getAccessToken(uniquePhone());
    const farMatch = await getAccessToken(uniquePhone());

    await buildCandidate(viewer.token, {
      displayName: 'E2E-AiSearch-Viewer3',
      birthYear: 1990,
      gender: 'MALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });
    // Real bio -> real ProfileService.updateProfile() -> real embedding (FR-112).
    await buildCandidate(closeMatch.token, {
      displayName: 'E2E-AiSearch-CloseMatch',
      birthYear: 1991,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      verify: true,
      bio: 'عاشق کوهنوردی و طبیعت‌گردی هستم، هر آخر هفته می‌رم کوه',
    });
    await buildCandidate(farMatch.token, {
      displayName: 'E2E-AiSearch-FarMatch',
      birthYear: 1991,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      verify: true,
      bio: 'برنامه‌نویس هستم و بیشتر وقتم رو پای کامپیوتر می‌گذرونم',
    });

    const auth = `Bearer ${viewer.token}`;

    // FR-111: closeMatch's bio is semantically nearer this query than
    // farMatch's, so it must rank strictly ahead of it. Asserted relatively
    // (closeMatch before farMatch) rather than as "closeMatch is the
    // global #1 result" — the real dev database keeps growing (never reset
    // between e2e runs, per this project's own real-infra testing
    // standard) and may contain other real historical candidates whose
    // bios also embed close to this query; see
    // test/helpers/paginate-to-exhaustion.ts for the same reasoning
    // applied elsewhere. A relative-ranking assertion proves the real
    // thing FR-111 cares about (closer bio -> better rank) without
    // depending on the database's total historical size.
    const allCandidates = await fetchFullSearch<SearchCandidate>(
      app.getHttpServer(),
      viewer.token,
      { mode: 'TEXT', semanticQuery: 'یه نفر که عاشق طبیعت و کوهنوردیه' },
    );
    const ids = allCandidates.map((c) => c.id);
    const closeIndex = ids.indexOf(closeMatch.userId);
    const farIndex = ids.indexOf(farMatch.userId);
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(farIndex).toBeGreaterThanOrEqual(0);
    expect(closeIndex).toBeLessThan(farIndex);

    // FR-113: a small-limit page followed by its cursor-continuation page
    // returns disjoint candidates, not a repeat.
    const page1 = (
      await request(app.getHttpServer())
        .post('/v1/discovery/ai-search')
        .set('Authorization', auth)
        .send({
          mode: 'TEXT',
          semanticQuery: 'یه نفر که عاشق طبیعت و کوهنوردیه',
          limit: 1,
        })
        .expect(201)
    ).body as SearchResponseBody;
    expect(page1.candidates).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = (
      await request(app.getHttpServer())
        .post('/v1/discovery/ai-search')
        .set('Authorization', auth)
        .send({
          mode: 'TEXT',
          semanticQuery: 'یه نفر که عاشق طبیعت و کوهنوردیه',
          limit: 1,
          cursor: page1.nextCursor,
        })
        .expect(201)
    ).body as SearchResponseBody;
    expect(page2.candidates).toHaveLength(1);
    expect(page2.candidates[0].id).not.toBe(page1.candidates[0].id);
  }, 60000);

  it('includes an un-embedded candidate unranked, after every ranked one — never excluded (FR-112)', async () => {
    const viewer = await getAccessToken(uniquePhone());
    const ranked = await getAccessToken(uniquePhone());
    const unranked = await getAccessToken(uniquePhone());

    await buildCandidate(viewer.token, {
      displayName: 'E2E-AiSearch-Viewer4',
      birthYear: 1990,
      gender: 'MALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });
    await buildCandidate(ranked.token, {
      displayName: 'E2E-AiSearch-Ranked',
      birthYear: 1991,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      verify: true,
      bio: 'اهل موسیقی و سفر',
    });
    // No bio at all -> bioEmbedding stays NULL.
    await buildCandidate(unranked.token, {
      displayName: 'E2E-AiSearch-Unranked',
      birthYear: 1991,
      gender: 'FEMALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });

    const candidates = await fetchFullSearch<SearchCandidate>(
      app.getHttpServer(),
      viewer.token,
      {
        mode: 'TEXT',
        semanticQuery: 'اهل موسیقی',
      },
    );
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain(unranked.userId); // never excluded
    const rankedIndex = ids.indexOf(ranked.userId);
    const unrankedIndex = ids.indexOf(unranked.userId);
    expect(rankedIndex).toBeGreaterThanOrEqual(0);
    expect(unrankedIndex).toBeGreaterThan(rankedIndex); // unranked sorts after
  }, 90000);

  it('returns an honest empty list, never a fabricated candidate, when nothing matches (FR-114)', async () => {
    const viewer = await getAccessToken(uniquePhone());
    await buildCandidate(viewer.token, {
      displayName: 'E2E-AiSearch-Viewer5',
      birthYear: 1990,
      gender: 'MALE',
      datingIntent: 'SERIOUS',
      verify: true,
    });

    const res = (
      await request(app.getHttpServer())
        .post('/v1/discovery/ai-search')
        .set('Authorization', `Bearer ${viewer.token}`)
        .send({
          mode: 'TEXT',
          semanticQuery: 'x',
          city: `NoSuchCity-${Date.now()}-zzz`,
          limit: 20,
        })
        .expect(201)
    ).body as SearchResponseBody;
    expect(res.candidates).toEqual([]);
    expect(res.nextCursor).toBeNull();
  });

  it('returns 503 naming the deck fallback when the embedding vendor fails (FR-116)', async () => {
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
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({
        // A real vendor failure always surfaces as ServiceUnavailableException
        // (OpenAiEmbeddingProvider's own fail-closed contract) — matching
        // that here, not a bare Error, is what makes this a real test of
        // FR-116's fallback-hint wrapping rather than of the global
        // exception filter's generic 500 path (a real bug this exact
        // mismatch caused a false failure over, caught before trusting it —
        // see test/helpers/vendor-failure.ts for why this is centralized).
        embed: () => rejectVendorUnavailable('vendor unreachable'),
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
      async function signUp(phone: string): Promise<VerifyResponseBody> {
        await request(failingApp.getHttpServer())
          .post('/v1/auth/otp/request')
          .send({ phone })
          .expect(202);
        const res = await request(failingApp.getHttpServer())
          .post('/v1/auth/otp/verify')
          .send({ phone, code: capturedCode })
          .expect(200);
        const body = res.body as VerifyResponseBody;
        createdUserIds.push(body.user.id);
        return body;
      }

      const viewer = await signUp(uniquePhone());
      const candidate = await signUp(uniquePhone());

      // The viewer must also be verified: an unverified viewer only sees
      // candidates whose messagingPermission is EVERYONE (FR-79), and the
      // candidate below defaults to VERIFIED_ONLY — leaving the viewer
      // unverified silently emptied the hard-filtered pool here before,
      // which (correctly, per FR-114) short-circuited before ever reaching
      // FR-111's embedding call and produced a false pass on this test.
      const viewerAuth = `Bearer ${viewer.accessToken}`;
      await request(failingApp.getHttpServer())
        .post('/v1/consent/biometric')
        .set('Authorization', viewerAuth)
        .send({ policyVersion: 'v1' })
        .expect(201);
      await request(failingApp.getHttpServer())
        .post('/v1/verification/liveness/session')
        .set('Authorization', viewerAuth)
        .expect(201);

      // A real candidate has to actually exist and survive the hard filter
      // (FR-109), otherwise the search short-circuits at FR-114's empty-pool
      // path before ever reaching FR-111's embedding call — this is what
      // makes the failure below a genuine test of the embedding call itself.
      const candidateAuth = `Bearer ${candidate.accessToken}`;
      await request(failingApp.getHttpServer())
        .patch('/v1/profile')
        .set('Authorization', candidateAuth)
        .send({
          displayName: 'E2E-AiSearch-VendorFail',
          birthDate: '1992-01-01',
          // Feature 24 (FR-435): see the other buildCompleteProfile note
          // above — a real candidate must actually complete to survive
          // FR-109's hard filter.
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
        .set('Authorization', candidateAuth)
        .attach('photo', jpeg, { filename: 'p.jpg', contentType: 'image/jpeg' })
        .expect(201);
      await request(failingApp.getHttpServer())
        .post('/v1/consent/biometric')
        .set('Authorization', candidateAuth)
        .send({ policyVersion: 'v1' })
        .expect(201);
      await request(failingApp.getHttpServer())
        .post('/v1/verification/liveness/session')
        .set('Authorization', candidateAuth)
        .expect(201);

      const res = await request(failingApp.getHttpServer())
        .post('/v1/discovery/ai-search')
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ mode: 'TEXT', semanticQuery: 'x', limit: 10 })
        .expect(503);
      expect((res.body as { detail: string }).detail).toMatch(
        /\/v1\/discovery\/deck/,
      );
    } finally {
      await failingApp.close();
    }
  }, 60000); // two full verified profiles' worth of real vendor calls
});
