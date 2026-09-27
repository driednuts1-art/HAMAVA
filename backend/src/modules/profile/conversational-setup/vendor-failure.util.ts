import { ServiceUnavailableException } from '@nestjs/common';

/**
 * FR-147: wraps a real vendor call (extraction or transcription) so a
 * `ServiceUnavailableException` carries an explicit pointer to the
 * always-available fallback — mirrors Feature 9's `withDeckFallbackHint`
 * exactly, pointed at `PATCH /v1/profile` instead of the deck.
 */
export async function withProfileFallbackHint<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceUnavailableException) {
      const original =
        (err.getResponse() as { message?: string }).message ?? err.message;
      throw new ServiceUnavailableException(
        `${original} Try PATCH /v1/profile instead.`,
      );
    }
    throw err;
  }
}
