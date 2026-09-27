"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { requestOtp } from "@/lib/queries/auth";
import { getSafeErrorMessage } from "@/lib/safe-error-message";
import { ErrorState } from "@/components/page-states";

// FR-213: mirrors backend/src/modules/auth/dto/request-otp.dto.ts's own
// E.164 pattern exactly — the backend remains the real authority, this only
// avoids a wasted round-trip on an obviously-malformed number.
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function PhoneStep({
  onRequested,
}: {
  onRequested: (phone: string, devCode?: string) => void;
}) {
  const t = useTranslations("auth.phone");
  const [phone, setPhone] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (value: string) => requestOtp(value),
    onSuccess: (data) => {
      // FR-214: a 202 always advances, regardless of whether the number
      // turned out to be real server-side — matching the backend's
      // deliberate non-enumeration response.
      onRequested(phone, data.devCode);
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!E164_PATTERN.test(phone)) {
      setValidationError(t("validationError"));
      return;
    }
    setValidationError(null);
    mutation.mutate(phone);
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
        {t("subtitle")}
      </p>
      <input
        type="tel"
        inputMode="tel"
        placeholder={t("placeholder")}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        aria-label={t("ariaLabel")}
        aria-invalid={Boolean(validationError)}
        className="rounded-[var(--radius-md-value)] border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-center text-lg text-[var(--text)] outline-none focus-visible:border-[var(--turquoise)]"
      />
      {validationError ? (
        <p role="alert" className="text-center text-sm text-[var(--rose)]">
          {validationError}
        </p>
      ) : null}
      {mutation.isError ? (
        // Same real bug/fix as the sibling OtpStep, delete-account-flow
        // (docs/roadmap.md): this used to show the backend's raw detail for
        // any failure, including an unexpected 500's raw English fallback.
        // requestOtp() is the same real function login and account-deletion
        // both call, so its one real expected case is the same real 429.
        <ErrorState
          {...getSafeErrorMessage(mutation.error, [
            {
              status: 429,
              detail: t("rateLimited"),
            },
          ])}
          onRetry={() => mutation.mutate(phone)}
        />
      ) : null}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-full bg-[var(--turquoise)] px-4 py-3 font-extrabold text-[#04211f] shadow-elevation-cta-turquoise disabled:opacity-50 disabled:shadow-none"
      >
        {mutation.isPending ? t("sending") : t("submit")}
      </button>
    </form>
  );
}
