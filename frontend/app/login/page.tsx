"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { PhoneStep } from "@/components/auth/phone-step";
import { OtpStep } from "@/components/auth/otp-step";
import { LivenessStep } from "@/components/auth/liveness-step";
import type { AuthUser } from "@/lib/auth-store";

type Step = "phone" | "otp" | "liveness";

// FR-419 (Feature 20): a real, distinct message after a real account
// deletion — never the plain, unexplained login screen. Read via
// `window.location.search` directly (not `useSearchParams()`) since the
// hard navigation that lands here (delete-account-flow.tsx) is a full page
// load anyway, and this avoids this otherwise-static-content page needing a
// Suspense boundary just for one query-param read.
function useAccountDeletedBanner(): boolean {
  // A lazy initializer, not an effect+setState (matches
  // app/(tabs)/matches/[matchId]/page.tsx's own identical
  // typeof-window-guarded-lazy-initializer precedent for a client-only,
  // one-time-per-mount read) — `window` doesn't exist during SSR, so the
  // server render always defaults to `false`.
  const [deleted] = useState(() =>
    typeof window === "undefined"
      ? false
      : new URLSearchParams(window.location.search).has("accountDeleted"),
  );
  return deleted;
}

export default function LoginPage() {
  const t = useTranslations("auth.login");
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>(undefined);
  const router = useRouter();
  const accountDeleted = useAccountDeletedBanner();

  function handleOtpRequested(phoneNumber: string, code?: string) {
    setPhone(phoneNumber);
    setDevCode(code);
    setStep("otp");
  }

  function handleVerified(user: AuthUser) {
    if (user.livenessStatus) {
      router.replace("/");
    } else {
      setStep("liveness");
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-6 py-16">
      <BrandMark />
      {accountDeleted && step === "phone" ? (
        <p
          role="status"
          className="max-w-sm rounded-[var(--radius-md-value)] border border-[var(--border)] bg-[var(--surface)] p-3 text-center text-sm text-[var(--text-muted)]"
        >
          {t("accountDeleted")}
        </p>
      ) : null}
      {step === "phone" ? (
        <PhoneStep onRequested={handleOtpRequested} />
      ) : null}
      {step === "otp" ? (
        <OtpStep
          phone={phone}
          initialDevCode={devCode}
          onVerified={handleVerified}
        />
      ) : null}
      {step === "liveness" ? (
        <LivenessStep onDone={() => router.replace("/")} />
      ) : null}
    </main>
  );
}
