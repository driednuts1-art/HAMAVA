"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * A real, user-reported "nothing happened after Save" investigation ruled
 * out a WelcomeTour render crash as the actual cause (root cause: PhotoGrid's
 * upload never syncs useAuthStore, a state-desync bug, not an exception —
 * docs/requirements.md Feature 29 §11) — but the user explicitly asked for
 * this boundary anyway, so a *future* genuinely different failure in this
 * overlay leaves a visible trace instead of silent, unexplained nothing.
 * Deliberately does not re-block the screen on error: trapping the user
 * behind a second silent wall would recreate the exact symptom this exists
 * to catch.
 *
 * A class component — useTranslations() (a hook) can't run here. Hardcoded
 * English at the current single-locale scope, same precedent as
 * lib/safe-error-message.ts's DEFAULT_FALLBACK; revisit if a real second
 * language is ever added (e.g. by having the caller pass a translated
 * fallback string as a prop).
 */
export class WelcomeTourErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // This component's only job on error is to leave a real trace, since a
    // real user has no devtools open to see a thrown-and-swallowed exception.
    console.error("WelcomeTour failed to render:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <p
          role="alert"
          className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit rounded-full border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-xs font-bold text-[var(--rose)] shadow-elevation-1"
        >
          There was a temporary problem showing the welcome tour.
        </p>
      );
    }
    return this.props.children;
  }
}
