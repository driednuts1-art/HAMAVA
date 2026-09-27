export const LIVENESS_PROVIDER = Symbol('LIVENESS_PROVIDER');

export type LivenessResultStatus = 'pending' | 'pass' | 'fail';

export interface LivenessSessionResult {
  providerSessionRef: string;
  status: LivenessResultStatus;
}

/**
 * Abstraction over the liveness-detection vendor (product.md §8.5: "do not
 * build in-house"). MUST stay result-only — pass/fail plus a provider
 * reference — and must never be extended to accept or return raw capture
 * frames, per the zero-retention requirement in product.md §5.
 */
export interface LivenessProviderInterface {
  /** Start (or, for synchronous mocks, complete) a liveness challenge for a user. */
  startSession(userId: string): Promise<LivenessSessionResult>;
}
