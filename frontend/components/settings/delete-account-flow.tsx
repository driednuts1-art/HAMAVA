"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { requestOtp } from "@/lib/queries/auth";
import { deleteAccount } from "@/lib/queries/settings";
import { useAuthStore } from "@/lib/auth-store";
import { getSafeErrorMessage } from "@/lib/safe-error-message";

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

type Step = "closed" | "warning" | "phone" | "code";

// FR-413..420: a real, multi-step, hard-to-misuse flow. Deliberately NOT a
// reuse of components/auth/{phone,otp}-step.tsx — those exist to log in
// (verifyOtp() establishes a *new* session); this flow's final action is a
// real DELETE authenticated by the caller's *already-existing* access
// token, with {phone, code} only as the re-verification body
// (docs/requirements.md Feature 20 §1).
export function DeleteAccountFlow() {
  const t = useTranslations("settings.deleteAccount");
  const [step, setStep] = useState<Step>("closed");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const requestMutation = useMutation({
    mutationFn: (value: string) => requestOtp(value),
    onSuccess: () => setStep("code"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAccount(phone, code),
    onSuccess: async () => {
      // FR-419: the Session row is already gone (cascade), but the httpOnly
      // refresh cookie is a separate client-side artifact nothing clears
      // automatically — its own backend-revoke call harmlessly no-ops
      // since the session's already gone, the cookie-clearing is the part
      // that still matters. Per explicit user direction: regardless of
      // whether this second call succeeds, the account deletion itself
      // already succeeded — a failure here must never leave the user in an
      // ambiguous state, so a hard navigation to /login always happens
      // either way (a real reload, not router.replace — guarantees a fresh
      // AuthRehydrator mount that re-checks the now-gone session for real,
      // the same safety-net shape api-client.ts's own fatal-401 path
      // already uses).
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch {
        // Deliberately swallowed — see the comment above.
      }
      useAuthStore.getState().clearSession();
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- matches api-client.ts's own identical fatal-session-end precedent
      window.location.href = "/login?accountDeleted=1";
    },
  });

  function handlePhoneSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!E164_PATTERN.test(phone)) {
      setPhoneError(t("phoneValidationError"));
      return;
    }
    setPhoneError(null);
    requestMutation.mutate(phone);
  }

  function handleCodeSubmit(event: React.FormEvent) {
    event.preventDefault();
    deleteMutation.mutate();
  }

  if (step === "closed") {
    return (
      <button
        type="button"
        onClick={() => setStep("warning")}
        className="rounded-full border border-[var(--danger)] px-4 py-3 text-left font-bold text-[var(--danger)] shadow-elevation-1"
      >
        {t("deleteAccount")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-lg-value)] border border-[var(--danger)] bg-[var(--surface)] p-4">
      {step === "warning" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-bold text-[var(--danger)]">
            {t("warningTitle")}
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            {t("warningBody")}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep("phone")}
              className="flex-1 rounded-full bg-[var(--danger)] px-4 py-2 text-sm font-extrabold text-white shadow-elevation-cta-danger"
            >
              {t("understandContinue")}
            </button>
            <button
              type="button"
              onClick={() => setStep("closed")}
              className="flex-1 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold text-[var(--text)]"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {step === "phone" ? (
        <form onSubmit={handlePhoneSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-[var(--text-muted)]">
            {t("reenterPhone")}
          </p>
          <input
            type="tel"
            inputMode="tel"
            placeholder={t("phonePlaceholder")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-label={t("phoneAriaLabel")}
            aria-invalid={Boolean(phoneError)}
            className="rounded-[var(--radius-md-value)] border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-center text-lg text-[var(--text)] outline-none focus-visible:border-[var(--danger)]"
          />
          {phoneError ? (
            <p role="alert" className="text-center text-sm text-[var(--danger)]">
              {phoneError}
            </p>
          ) : null}
          {requestMutation.isError ? (
            // A real bug (docs/roadmap.md), the same class already fixed
            // once in components/auth/otp-step.tsx: this used to show the
            // backend's raw, English detail for *any* failure — including
            // an unexpected 500's undertranslated "An unexpected error
            // occurred." Deletion is irreversible, so a confusing error
            // message here matters more than almost anywhere else in this
            // app. This screen reuses the same `requestOtp()` login uses,
            // so its one real expected case is the same real 429
            // (`otp.service.ts`'s `TooManyRequestsException`).
            <p role="alert" className="text-center text-sm text-[var(--danger)]">
              {
                getSafeErrorMessage(requestMutation.error, [
                  {
                    status: 429,
                    detail: t("rateLimited"),
                  },
                ]).detail
              }
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={requestMutation.isPending}
              className="flex-1 rounded-full bg-[var(--danger)] px-4 py-2 text-sm font-extrabold text-white shadow-elevation-cta-danger disabled:opacity-50 disabled:shadow-none"
            >
              {requestMutation.isPending ? t("sending") : t("sendCode")}
            </button>
            <button
              type="button"
              onClick={() => setStep("closed")}
              className="flex-1 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold text-[var(--text)]"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : null}

      {step === "code" ? (
        <form onSubmit={handleCodeSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-[var(--text-muted)]">
            {t("codeBody", { phone })}
          </p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label={t("codeAriaLabel")}
            className="rounded-[var(--radius-md-value)] border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-center text-2xl tracking-[0.4em] text-[var(--text)] outline-none focus-visible:border-[var(--danger)]"
          />
          {deleteMutation.isError ? (
            // Same real bug, same fix — `deleteAccount()` reuses
            // `OtpService.verifyOtp()` unchanged server-side
            // (account-deletion.service.ts), so its one real expected case
            // is the identical real 401 wrong/expired code.
            <p role="alert" className="text-center text-sm text-[var(--danger)]">
              {
                getSafeErrorMessage(deleteMutation.error, [
                  {
                    status: 401,
                    detail: t("wrongCode"),
                  },
                ]).detail
              }
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={deleteMutation.isPending || code.length !== 6}
              className="flex-1 rounded-full bg-[var(--danger)] px-4 py-2 text-sm font-extrabold text-white shadow-elevation-cta-danger disabled:opacity-50 disabled:shadow-none"
            >
              {deleteMutation.isPending ? t("deleting") : t("permanentlyDelete")}
            </button>
            <button
              type="button"
              onClick={() => setStep("closed")}
              className="flex-1 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold text-[var(--text)]"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
