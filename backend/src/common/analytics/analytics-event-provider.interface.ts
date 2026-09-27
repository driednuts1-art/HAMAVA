export const ANALYTICS_EVENT_PROVIDER = Symbol('ANALYTICS_EVENT_PROVIDER');

/**
 * FR-150 (Feature 11): a generic analytics-event sink, following this
 * codebase's established interface-abstraction pattern (Feature 1's
 * `OtpProviderInterface`/`LivenessProviderInterface`). This interface is
 * deliberately generic even though, today, exactly one call site uses it
 * (`profile_completed`, FR-152) — `product.md` §11's full event taxonomy
 * remains out of scope; adding a second real event later is a new decision,
 * not something this interface's shape silently invites.
 */
export interface AnalyticsEventProviderInterface {
  track(
    event: string,
    userId: string,
    properties: Record<string, unknown>,
  ): Promise<void>;
}
