import { ApiRequestError } from "./api-error";

export interface SafeErrorMessage {
  title: string;
  detail: string;
}

export interface ExpectedErrorCase {
  /** The real HTTP status this app already knows how to explain to a user. */
  status: number;
  title?: string;
  /**
   * A fixed Persian message for this status. Omit to show the real
   * backend `detail` verbatim instead — a deliberate, narrow exception for
   * a status this app already has a tested reason to trust (e.g.
   * date-share's own two distinct 409 sub-reasons, FR-156/173/383) — never
   * the default for a status with no case listed here at all.
   */
  detail?: string;
}

// Plain module-level constant, not a component — can't call useTranslations()
// here. Hardcoded English is fine at the current single-locale scope
// (docs/i18n-rtl-migration-scope.md); if this app ever adds a second real
// language, this needs a translated value passed in by each caller (which
// already has i18n context) rather than a fixed module-level default.
const DEFAULT_FALLBACK: SafeErrorMessage = {
  title: "Something went wrong",
  detail: "An unexpected error occurred. Please try again.",
};

/**
 * A real bug found live (not through any test), then found to recur at 7
 * more call sites once actually searched for (docs/roadmap.md, this
 * session's own findings): showing `ApiRequestError.problem.detail`
 * unconditionally for *any* mutation failure means a genuinely unexpected
 * backend error (a transient DB hiccup, any unhandled exception —
 * `ProblemDetailsFilter`'s own generic `'An unexpected error occurred.'`)
 * surfaces as raw, undertranslated, developer-diagnostic English text —
 * the exact class of bug FR-277/278 (Feature 26) already fixed once for AI
 * Search's own vendor-failure messages, each site having independently
 * grown its own copy of the same mistake since. This is the one shared
 * place that mistake gets fixed, so it can't recur an eighth time: pass
 * only the *specific* statuses this call site already has a real, tested
 * reason to show something for — anything else always gets the same safe,
 * generic Persian fallback, never the raw backend text.
 */
export function getSafeErrorMessage(
  error: unknown,
  expectedCases: ExpectedErrorCase[],
  fallback: SafeErrorMessage = DEFAULT_FALLBACK,
): SafeErrorMessage {
  if (error instanceof ApiRequestError) {
    const match = expectedCases.find((c) => c.status === error.problem.status);
    if (match) {
      return {
        title: match.title ?? fallback.title,
        detail: match.detail ?? error.problem.detail,
      };
    }
  }
  return fallback;
}
