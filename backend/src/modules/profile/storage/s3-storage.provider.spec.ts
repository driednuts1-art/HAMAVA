import { ConfigService } from '@nestjs/config';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const actual: object = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

const mockGetSignedUrl = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) =>
    (mockGetSignedUrl as (...a: unknown[]) => unknown)(...args),
}));

// Imported after the mocks above so the provider picks up the mocked SDK.
import { S3StorageProvider } from './s3-storage.provider';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

const CONFIG: Record<string, string | number> = {
  STORAGE_BUCKET: 'test-bucket',
  PHOTO_URL_EXPIRY_SECONDS: 900,
  STORAGE_ENDPOINT: 'http://127.0.0.1:9010',
  STORAGE_REGION: 'us-east-1',
  STORAGE_FORCE_PATH_STYLE: 'true',
  STORAGE_ACCESS_KEY_ID: 'test-key',
  STORAGE_SECRET_ACCESS_KEY: 'test-secret',
};

describe('S3StorageProvider', () => {
  let provider: S3StorageProvider;

  beforeEach(() => {
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;
    provider = new S3StorageProvider(config);
  });

  describe('save', () => {
    it('sends a PutObjectCommand with the bucket, key, body, and content type', async () => {
      mockSend.mockResolvedValue({});
      await provider.save('key-1', Buffer.from('data'), 'image/webp');

      expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
      const command = mockSend.mock.calls[0][0] as PutObjectCommand;
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'key-1',
        Body: Buffer.from('data'),
        ContentType: 'image/webp',
      });
    });
  });

  describe('read', () => {
    it('sends a GetObjectCommand and returns the body as a Buffer', async () => {
      mockSend.mockResolvedValue({
        Body: {
          transformToByteArray: jest
            .fn()
            .mockResolvedValue(new Uint8Array([1, 2, 3])),
        },
      });

      const result = await provider.read('key-1');

      expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
      expect(result).toEqual(Buffer.from([1, 2, 3]));
    });

    it('throws if the object has no readable body', async () => {
      mockSend.mockResolvedValue({ Body: undefined });
      await expect(provider.read('key-1')).rejects.toThrow(
        'Object has no readable body: key-1',
      );
    });
  });

  describe('delete', () => {
    it('sends a DeleteObjectCommand with the bucket and key', async () => {
      mockSend.mockResolvedValue({});
      await provider.delete('key-1');

      expect(mockSend).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
      const command = mockSend.mock.calls[0][0] as DeleteObjectCommand;
      expect(command.input).toEqual({ Bucket: 'test-bucket', Key: 'key-1' });
    });
  });

  describe('getUrl', () => {
    it('requests a presigned URL scoped to the configured expiry (FR-89)', async () => {
      mockGetSignedUrl.mockResolvedValue('https://signed.example/key-1');

      const url = await provider.getUrl('key-1');

      expect(url).toBe('https://signed.example/key-1');
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(GetObjectCommand),
        { expiresIn: 900 },
      );
      const command = mockGetSignedUrl.mock.calls[0][1] as GetObjectCommand;
      expect(command.input).toEqual({ Bucket: 'test-bucket', Key: 'key-1' });
    });
  });
});
