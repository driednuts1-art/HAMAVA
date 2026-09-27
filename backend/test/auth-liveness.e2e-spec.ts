import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { OTP_PROVIDER } from '../src/modules/auth/otp/otp-provider.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { uniquePhone } from './helpers/unique-phone';

interface VerifyResponseBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; livenessStatus: boolean };
}

interface RefreshResponseBody {
  accessToken: string;
  refreshToken: string;
}

interface StatusResponseBody {
  livenessStatus: boolean;
}

/**
 * End-to-end test for the full "phone auth + liveness verification" journey
 * (docs/requirements.md §4), run against a real database connection (no DB
 * mocking) as required by product.md §10. Only the OTP delivery provider is
 * swapped for a capturing stub, so the test can read the generated code
 * without scraping logs — everything else is the real app wiring.
 */
describe('Phone auth + liveness verification (e2e)', () => {
  let app: INestApplication<App>;
  let capturedCode: string;
  // Deleted in afterAll — without this, every run leaves a real row behind
  // and the shared dev DB accumulates test accounts across runs (this bit a
  // Feature 3 e2e test via a false-positive before this cleanup existed).
  const createdUserIds: string[] = [];

  const phone = uniquePhone();

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

  it('completes request -> verify -> consent -> liveness -> status', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone })
      .expect(202);

    expect(capturedCode).toMatch(/^\d{6}$/);

    const verifyRes = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ phone, code: capturedCode })
      .expect(200);
    const verifyBody = verifyRes.body as VerifyResponseBody;

    expect(verifyBody.accessToken).toBeDefined();
    expect(verifyBody.refreshToken).toBeDefined();
    expect(verifyBody.user.livenessStatus).toBe(false);
    createdUserIds.push(verifyBody.user.id);
    const { accessToken } = verifyBody;
    let { refreshToken } = verifyBody;

    // FR-11: liveness cannot start before consent.
    await request(app.getHttpServer())
      .post('/v1/verification/liveness/session')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post('/v1/consent/biometric')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ policyVersion: 'v1' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/verification/liveness/session')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    const statusRes = await request(app.getHttpServer())
      .get('/v1/verification/liveness/status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const statusBody = statusRes.body as StatusResponseBody;

    expect(statusBody.livenessStatus).toBe(true);

    // FR-8..FR-10: refresh rotates the token and invalidates the old one.
    const refreshRes = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    const refreshBody = refreshRes.body as RefreshResponseBody;
    expect(refreshBody.refreshToken).not.toBe(refreshToken);
    refreshToken = refreshBody.refreshToken;

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: verifyBody.refreshToken })
      .expect(401);
  });
});
