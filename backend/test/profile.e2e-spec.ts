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

interface VerifyResponseBody {
  accessToken: string;
  user: { id: string };
}

interface ProfileResponseBody {
  displayName: string | null;
  profileCompletedAt: string | null;
  photos: { id: string; position: number; url: string }[];
}

interface UploadResponseBody {
  id: string;
  position: number;
}

/**
 * End-to-end test for "basic profile creation" (docs/requirements.md Feature 2),
 * run against a real database connection, exercising the real multipart-upload
 * pipeline (multer + FileInterceptor + sharp re-encoding), not a mock of it.
 */
describe('Basic profile creation (e2e)', () => {
  let app: INestApplication<App>;
  let capturedCode: string;
  // Deleted in afterAll so re-running this suite doesn't leave real rows
  // behind in the shared dev DB (see auth-liveness.e2e-spec.ts for why this matters).
  const createdUserIds: string[] = [];

  const phone = uniquePhone();

  async function getAccessToken(forPhone: string): Promise<string> {
    await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone: forPhone })
      .expect(202);
    const verifyRes = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ phone: forPhone, code: capturedCode })
      .expect(200);
    const body = verifyRes.body as VerifyResponseBody;
    createdUserIds.push(body.user.id);
    return body.accessToken;
  }

  async function makeJpeg(): Promise<Buffer> {
    return sharp({
      create: {
        width: 64,
        height: 48,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .jpeg()
      .withExif({ IFD0: { Make: 'e2e-test' } })
      .toBuffer();
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

  it('rejects an under-18 birthDate (FR-20)', async () => {
    const token = await getAccessToken(phone);
    await request(app.getHttpServer())
      .patch('/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        birthDate: new Date(Date.now() - 10 * 365 * 86400 * 1000).toISOString(),
      })
      .expect(400);
  });

  it('builds a profile incrementally, uploads a photo through the real pipeline, and marks completion', async () => {
    const token = await getAccessToken(phone);
    const auth = `Bearer ${token}`;

    await request(app.getHttpServer())
      .patch('/v1/profile')
      .set('Authorization', auth)
      .send({
        displayName: 'E2E Tester',
        birthDate: '1995-06-01',
        interests: ['music', 'code'],
        // Feature 24 (FR-435): profile completeness now also requires 2
        // real prompt answers, alongside displayName/birthDate/photo — a
        // real regression found re-running this pre-existing test after
        // that feature shipped (it used to complete with just the photo).
        promptAnswers: [
          { promptId: 'best-night', answer: 'A quiet night with good music.' },
          { promptId: 'weird-fact', answer: "I can solve a Rubik's cube." },
        ],
      })
      .expect(200);

    let profile = (
      await request(app.getHttpServer())
        .get('/v1/profile/me')
        .set('Authorization', auth)
        .expect(200)
    ).body as ProfileResponseBody;
    expect(profile.displayName).toBe('E2E Tester');
    expect(profile.profileCompletedAt).toBeNull(); // no photo yet (FR-34)

    const jpeg = await makeJpeg();
    await request(app.getHttpServer())
      .post('/v1/profile/photos')
      .set('Authorization', auth)
      .attach('photo', jpeg, {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    profile = (
      await request(app.getHttpServer())
        .get('/v1/profile/me')
        .set('Authorization', auth)
        .expect(200)
    ).body as ProfileResponseBody;
    expect(profile.profileCompletedAt).not.toBeNull(); // FR-34: now complete
    expect(profile.photos).toHaveLength(1);

    // FR-31/FR-91: fetched directly from the URL — no Authorization header,
    // no dependency on this API — proving real re-encoding happened (WebP,
    // no EXIF, FR-27) via bytes that never touched the API origin.
    const photoUrl = profile.photos[0].url;
    const directRes = await fetch(photoUrl);
    expect(directRes.status).toBe(200);
    const fileBuffer = Buffer.from(await directRes.arrayBuffer());
    const meta = await sharp(fileBuffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
  });

  it('no longer exposes the retired dev-only same-origin file route (FR-94)', async () => {
    const token = await getAccessToken(phone);
    const jpeg = await makeJpeg();
    const uploadRes = await request(app.getHttpServer())
      .post('/v1/profile/photos')
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', jpeg, {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    const photo = uploadRes.body as UploadResponseBody;

    await request(app.getHttpServer())
      .get(`/v1/profile/photos/${photo.id}/file`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('rejects a non-image upload before it is ever stored (FR-25)', async () => {
    const token = await getAccessToken(phone);
    await request(app.getHttpServer())
      .post('/v1/profile/photos')
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', Buffer.from('not an image'), {
        filename: 'fake.txt',
        contentType: 'text/plain',
      })
      .expect(415);
  });

  it('enforces resource-level authorization on photo deletion (FR-32)', async () => {
    const ownerToken = await getAccessToken(phone);
    const jpeg = await makeJpeg();
    const uploadRes = await request(app.getHttpServer())
      .post('/v1/profile/photos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('photo', jpeg, {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    const photo = uploadRes.body as UploadResponseBody;

    const otherPhone = uniquePhone();
    const otherToken = await getAccessToken(otherPhone);

    await request(app.getHttpServer())
      .delete(`/v1/profile/photos/${photo.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/v1/profile/photos/${photo.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('actually removes the file from storage on delete, not just the DB row', async () => {
    const token = await getAccessToken(phone);
    const jpeg = await makeJpeg();
    const uploadRes = await request(app.getHttpServer())
      .post('/v1/profile/photos')
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', jpeg, {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    const photo = uploadRes.body as UploadResponseBody;

    // Resolve the real (non-HTTP) storage + DB layer to check what's actually
    // on disk, independent of what the API claims.
    const prisma = app.get(PrismaService);
    const storage = app.get<StorageProviderInterface>(STORAGE_PROVIDER);

    const row = await prisma.photo.findUniqueOrThrow({
      where: { id: photo.id },
    });
    // Sanity check: the file is really there before we delete it.
    await expect(storage.read(row.storageKey)).resolves.toBeInstanceOf(Buffer);

    await request(app.getHttpServer())
      .delete(`/v1/profile/photos/${photo.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // The DB row is gone...
    await expect(
      prisma.photo.findUnique({ where: { id: photo.id } }),
    ).resolves.toBeNull();
    // ...and so is the physical file (not just a DB-row delete).
    await expect(storage.read(row.storageKey)).rejects.toThrow();
  });
});
