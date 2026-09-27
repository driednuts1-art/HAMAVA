import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageProviderInterface } from './storage-provider.interface';

/**
 * FR-90: a real object-storage implementation over the standard S3 protocol
 * — works unchanged against any S3-compatible endpoint (MinIO in dev/test,
 * any real vendor in production; see docs/requirements.md Feature 7 §10 for
 * why MinIO alone isn't sufficient sign-off — a real cloud vendor pass is
 * required too before this is considered production-ready).
 */
@Injectable()
export class S3StorageProvider implements StorageProviderInterface {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly urlExpirySeconds: number;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('STORAGE_BUCKET');
    this.urlExpirySeconds = config.getOrThrow<number>(
      'PHOTO_URL_EXPIRY_SECONDS',
    );
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>('STORAGE_ENDPOINT'),
      region: config.getOrThrow<string>('STORAGE_REGION'),
      forcePathStyle:
        config.getOrThrow<string>('STORAGE_FORCE_PATH_STYLE') === 'true',
      credentials: {
        accessKeyId: config.getOrThrow<string>('STORAGE_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('STORAGE_SECRET_ACCESS_KEY'),
      },
    });
  }

  async save(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async read(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`Object has no readable body: ${key}`);
    }
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /** FR-89: freshly signed on every call — never persisted, never permanent. */
  getUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: this.urlExpirySeconds },
    );
  }
}
