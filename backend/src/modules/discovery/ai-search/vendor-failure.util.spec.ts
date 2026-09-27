import { ServiceUnavailableException } from '@nestjs/common';
import { withDeckFallbackHint } from './vendor-failure.util';

describe('withDeckFallbackHint (FR-116)', () => {
  it('resolves the value unchanged on success', async () => {
    await expect(withDeckFallbackHint(() => Promise.resolve(42))).resolves.toBe(
      42,
    );
  });

  it('re-throws a ServiceUnavailableException with the deck fallback named', async () => {
    await expect(
      withDeckFallbackHint(() =>
        Promise.reject(new ServiceUnavailableException('vendor down')),
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('/v1/discovery/deck'),
    });
  });

  it('preserves the original error detail alongside the fallback hint', async () => {
    await expect(
      withDeckFallbackHint(() =>
        Promise.reject(
          new ServiceUnavailableException('embedding service returned 500'),
        ),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('embedding service returned 500'),
    });
  });

  it('does not alter or mask a non-ServiceUnavailableException error', async () => {
    await expect(
      withDeckFallbackHint(() => Promise.reject(new Error('something else'))),
    ).rejects.toThrow('something else');
  });
});
