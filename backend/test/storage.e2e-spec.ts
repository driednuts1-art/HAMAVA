import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3StorageProvider } from '../src/modules/profile/storage/s3-storage.provider';

/**
 * End-to-end test for Real Photo Storage (docs/requirements.md Feature 7),
 * run against the real local MinIO server directly — not through the HTTP
 * API — because this test's whole point is verifying the presigned-URL
 * expiry mechanism itself (FR-89), which needs a short, controlled expiry
 * the app's own .env-configured 900s default can't reasonably exercise in
 * a test run. Uses the exact same S3 protocol code path (S3StorageProvider)
 * against the exact same bucket/credentials as the running app, just with
 * its own short-lived ConfigService so the wait is seconds, not minutes.
 */
describe('Real Photo Storage — presigned URL expiry (e2e)', () => {
  function buildProvider(expirySeconds: number): S3StorageProvider {
    const values: Record<string, string | number> = {
      STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT!,
      STORAGE_REGION: process.env.STORAGE_REGION!,
      STORAGE_BUCKET: process.env.STORAGE_BUCKET!,
      STORAGE_ACCESS_KEY_ID: process.env.STORAGE_ACCESS_KEY_ID!,
      STORAGE_SECRET_ACCESS_KEY: process.env.STORAGE_SECRET_ACCESS_KEY!,
      STORAGE_FORCE_PATH_STYLE: process.env.STORAGE_FORCE_PATH_STYLE!,
      PHOTO_URL_EXPIRY_SECONDS: expirySeconds,
    };
    const config = {
      getOrThrow: (key: string) => {
        const value = values[key];
        if (value === undefined) {
          throw new Error(`Missing required env var for this test: ${key}`);
        }
        return value;
      },
    } as unknown as ConfigService;
    return new S3StorageProvider(config);
  }

  it('rejects the same presigned URL after it expires — not a permanent public link (FR-89)', async () => {
    const provider = buildProvider(2); // 2s, real wait below — not the app's 900s default
    const key = `e2e-expiry-test-${randomUUID()}.txt`;

    await provider.save(
      key,
      Buffer.from('presigned url expiry test'),
      'text/plain',
    );
    try {
      const url = await provider.getUrl(key);

      const beforeExpiry = await fetch(url);
      expect(beforeExpiry.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 2500));

      const afterExpiry = await fetch(url);
      expect(afterExpiry.status).toBe(403); // S3 protocol: expired signature
    } finally {
      await provider.delete(key);
    }
  }, 15000);

  it('carries a signature whose encoded expiry matches the configured window, not an arbitrary/permanent one', async () => {
    const provider = buildProvider(123);
    const key = `e2e-url-shape-test-${randomUUID()}.txt`;

    await provider.save(key, Buffer.from('url shape test'), 'text/plain');
    try {
      const url = await provider.getUrl(key);
      const params = new URL(url).searchParams;

      // A real presigned URL, not a bare/public one: carries SigV4 auth params.
      expect(params.get('X-Amz-Signature')).toBeTruthy();
      expect(params.get('X-Amz-Expires')).toBe('123');

      const res = await fetch(url);
      expect(res.status).toBe(200);
    } finally {
      await provider.delete(key);
    }
  });
});

/**
 * The app's storage credentials (`hamava_app`) are a least-privilege user,
 * scoped by an explicit IAM-style policy to only the app's own bucket — not
 * MinIO's root user. That policy was created once via `mc admin policy
 * create`/`attach` (docs/architecture.md §5.4), which proves the policy
 * exists and is attached, but not that it actually confines anything: a
 * typo'd resource ARN or an overly broad action list would still "look"
 * scoped on paper while granting more than intended. This suite tries the
 * denied operations for real, with the app's actual credentials, against a
 * real foreign bucket — not just reading the policy JSON back.
 */
describe('Real Photo Storage — least-privilege app credentials (e2e)', () => {
  function readRootCredentials(): { user: string; password: string } {
    const path = 'C:\\MinIO\\root-credentials.env';
    let contents: string;
    try {
      contents = readFileSync(path, 'utf8');
    } catch {
      throw new Error(
        `This test needs MinIO's root credentials to set up a foreign bucket ` +
          `it can then prove the app user is denied access to. Expected them ` +
          `at ${path} (docs/architecture.md §5.4) — not found. This file is ` +
          `deliberately outside the repo and never given to the app itself.`,
      );
    }
    const user = /MINIO_ROOT_USER=(.+)/.exec(contents)?.[1]?.trim();
    const password = /MINIO_ROOT_PASSWORD=(.+)/.exec(contents)?.[1]?.trim();
    if (!user || !password) {
      throw new Error(`Could not parse MinIO root credentials from ${path}.`);
    }
    return { user, password };
  }

  function buildClient(accessKeyId: string, secretAccessKey: string): S3Client {
    return new S3Client({
      endpoint: process.env.STORAGE_ENDPOINT!,
      region: process.env.STORAGE_REGION!,
      forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  const foreignBucket = `hamava-security-probe-${randomUUID()}`;
  let rootClient: S3Client;
  let appClient: S3Client;

  beforeAll(async () => {
    const root = readRootCredentials();
    rootClient = buildClient(root.user, root.password);
    appClient = buildClient(
      process.env.STORAGE_ACCESS_KEY_ID!,
      process.env.STORAGE_SECRET_ACCESS_KEY!,
    );

    // A bucket the app's own bucket-scoped policy grants nothing on.
    await rootClient.send(new CreateBucketCommand({ Bucket: foreignBucket }));
    await rootClient.send(
      new PutObjectCommand({
        Bucket: foreignBucket,
        Key: 'secret.txt',
        Body: Buffer.from('root-only data'),
      }),
    );
  });

  afterAll(async () => {
    await rootClient
      .send(
        new DeleteObjectCommand({ Bucket: foreignBucket, Key: 'secret.txt' }),
      )
      .catch(() => undefined);
    await rootClient
      .send(new DeleteBucketCommand({ Bucket: foreignBucket }))
      .catch(() => undefined);
  });

  it("denies writing into a bucket outside the app credential's policy grant", async () => {
    await expect(
      appClient.send(
        new PutObjectCommand({
          Bucket: foreignBucket,
          Key: 'should-not-write.txt',
          Body: Buffer.from('x'),
        }),
      ),
    ).rejects.toMatchObject({ Code: expect.stringMatching(/AccessDenied/i) });
  });

  it('denies reading an object from a bucket outside the policy grant', async () => {
    await expect(
      appClient.send(
        new GetObjectCommand({ Bucket: foreignBucket, Key: 'secret.txt' }),
      ),
    ).rejects.toMatchObject({ Code: expect.stringMatching(/AccessDenied/i) });
  });

  it('denies deleting a bucket entirely (not just an object) — no admin-level grant', async () => {
    await expect(
      appClient.send(new DeleteBucketCommand({ Bucket: foreignBucket })),
    ).rejects.toMatchObject({ Code: expect.stringMatching(/AccessDenied/i) });
  });

  it('denies creating a new bucket — an account-wide operation, not a bucket-scoped one', async () => {
    // Kept short and simple on purpose: a name that's too long/invalid gets
    // rejected by S3 request validation before the IAM policy is even
    // evaluated (InvalidBucketName, not AccessDenied) — that would prove
    // nothing about the actual permission boundary this test exists to check.
    const newBucketName = `hamava-probe-${randomUUID().slice(0, 8)}`;
    await expect(
      appClient.send(new CreateBucketCommand({ Bucket: newBucketName })),
    ).rejects.toMatchObject({ Code: expect.stringMatching(/AccessDenied/i) });
  });

  it("does not leak the foreign bucket's existence via ListBuckets — only the app's own bucket is visible", async () => {
    const result = await appClient.send(new ListBucketsCommand({}));
    const names = (result.Buckets ?? []).map((b) => b.Name);
    expect(names).not.toContain(foreignBucket);
  });
});
