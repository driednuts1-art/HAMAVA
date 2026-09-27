export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/**
 * Abstraction over the object-storage vendor for uploaded media. Backed by a
 * real S3-compatible implementation since Feature 7 (docs/requirements.md) —
 * any S3-compatible endpoint works unchanged, only STORAGE_* env vars differ
 * between MinIO (dev/test) and a real vendor (production).
 */
export interface StorageProviderInterface {
  save(key: string, data: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** FR-89: presigned, time-limited (PHOTO_URL_EXPIRY_SECONDS) — never a permanent public link. */
  getUrl(key: string): Promise<string>;
}
