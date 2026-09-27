import { ServiceUnavailableException } from '@nestjs/common';

/**
 * FR-116: wraps a real vendor call (extraction, transcription, or
 * embedding) so a `ServiceUnavailableException` from any of them carries an
 * explicit pointer to the existing structured-filter fallback — this is a
 * UX-availability fallback, not a security fail-closed (contrast FR-100's
 * malware-scan/moderation posture), so the client is told exactly what to
 * fall back to rather than just seeing an opaque 503.
 */
export async function withDeckFallbackHint<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceUnavailableException) {
      const original =
        (err.getResponse() as { message?: string }).message ?? err.message;
      throw new ServiceUnavailableException(
        `${original} Try GET /v1/discovery/deck instead.`,
      );
    }
    throw err;
  }
}
