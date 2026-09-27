"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { requestOtp, verifyOtp } from "@/lib/queries/auth";
import { getSafeErrorMessage } from "@/lib/safe-error-message";
import { ErrorState } from "@/components/page-states";
import type { AuthUser } from "@/lib/auth-store";

const RESEND_COOLDOWN_SECONDS = 30;

export function OtpStep({
  phone,
  initialDevCode,
  onVerified,
}: {
  phone: string;
  initialDevCode?: string;
  onVerified: (user: AuthUser) => void;
}) {
  const t = useTranslations("auth.otp");
  const [code, setCode] = useState(initialDevCode ?? "");
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const verifyMutation = useMutation({
    mutationFn: () => verifyOtp(phone, code),
    onSuccess: (data) => onVerified(data.user),
  });

  const resendMutation = useMutation({
    mutationFn: () => requestOtp(phone),
    onSuccess: (data) => {
      setCooldown(RESEND_COOLDOWN_SECONDS);
      if (data.devCode) setCode(data.devCode);
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    verifyMutation.mutate();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <h1 className="text-center text-2xl font-extrabold tracking-[-0.01em]">
        {t("title")}
      </h1>
      <p className="text-center text-sm text-[var(--text-muted)]">
        {t("subtitle", { phone })}
      </p>
      <input
        type="text"
        inputMode="numeric"
        maxLength={6}
        placeholder="123456"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        aria-label={t("ariaLabel")}
        className="rounded-[var(--radius-md-value)] border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-center text-2xl tracking-[0.4em] text-[var(--text)] outline-none focus-visible:border-[var(--turquoise)]"
      />
      {verifyMutation.isError ? (
        // A real, previously-untested bug found live, now fixed via the
        // one shared helper every affected call site uses (docs/roadmap.md)
        // — this used to show the hardcoded "کد اشتباهه" title alongside
        // whatever the backend's raw `detail` happened to be, for EVERY
        // verify failure, including a genuine unexpected 500 (e.g. a
        // transient DB hiccup under load) whose real detail is the generic,
        // undertranslated "An unexpected error occurred." A real wrong code
        // is genuinely a 401 (`otp.service.ts`'s own `UnauthorizedException`);
        // anything else means something actually broke, not that the code
        // was wrong.
        (() => {
          const { title, detail } = getSafeErrorMessage(verifyMutation.error, [
            { status: 401, title: t("wrongCodeTitle"), detail: t("wrongCodeDetail") },
          ]);
          return <ErrorState title={title} detail={detail} />;
        })()
      ) : null}
      <button
        type="submit"
        disabled={verifyMutation.isPending || code.length !== 6}
        className="rounded-full bg-[var(--turquoise)] px-4 py-3 font-extrabold text-[#04211f] shadow-elevation-cta-turquoise disabled:opacity-50 disabled:shadow-none"
      >
        {verifyMutation.isPending ? t("verifying") : t("submit")}
      </button>
      {/* FR-216: a real client-side cooldown, so a user can't hammer the
          backend's own rate limiter into an unexplained 429. --text-faint
          only appears here in its genuinely disabled state — WCAG 1.4.3
          exempts inactive UI component text from the contrast requirement
          (--text-faint measures 3.78:1 on --bg, below AA's 4.5:1 for active
          text; docs/design-system.md §7). */}
      <button
        type="button"
        disabled={cooldown > 0 || resendMutation.isPending}
        onClick={() => resendMutation.mutate()}
        className="text-center text-sm text-[var(--turquoise)] disabled:text-[var(--text-faint)]"
      >
        {cooldown > 0 ? t("resendCooldown", { seconds: cooldown }) : t("resend")}
      </button>
    </form>
  );
}
