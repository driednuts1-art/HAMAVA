import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Every real vendor provider in this codebase (OpenAI extraction,
 * transcription, embedding, match-explanation, moderation, ...) fails
 * CLOSED by throwing `ServiceUnavailableException` — never a bare `Error`.
 * An e2e test simulating "the vendor is down" must throw that exact shape,
 * or it silently stops testing the real failure path: a `withXFallbackHint`
 * -style wrapper (`withDeckFallbackHint`, `withProfileFallbackHint`, and
 * whatever the next feature's equivalent is called) only rewrites
 * `ServiceUnavailableException` instances specifically — a bare `Error`
 * sails through unrewritten and surfaces as a genuine 500, which looks like
 * a real bug rather than "vendor down" and makes the test's own
 * `.expect(503)` fail for a reason that has nothing to do with the code
 * under test.
 *
 * This is not hypothetical: the exact same test-authoring mistake (a mock
 * throwing `new Error('vendor down')` instead of this) was made and caught
 * twice independently — once in Feature 9's `ai-search.e2e-spec.ts`, once
 * in Feature 11's `conversational-setup.e2e-spec.ts` — before this helper
 * existed to centralize the correct shape. Use it in every new
 * vendor-failure mock instead of hand-rolling the exception again.
 */
export function rejectVendorUnavailable<T = never>(
  message = 'vendor down',
): Promise<T> {
  return Promise.reject(new ServiceUnavailableException(message));
}
