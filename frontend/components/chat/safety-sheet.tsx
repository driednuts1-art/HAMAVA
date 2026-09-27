"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import {
  blockConversationPartner,
  reportConversationPartner,
  type ReportReasonCategory,
} from "@/lib/queries/chat";
import { getSafeErrorMessage } from "@/lib/safe-error-message";
import { CloseIcon, ShieldIcon } from "@/components/icons";

const CATEGORY_VALUES: ReportReasonCategory[] = [
  "SPAM",
  "FAKE_PROFILE",
  "HARASSMENT",
  "SCAM_OR_FINANCIAL",
  "OTHER",
];

type Step = "menu" | "block-confirm" | "report";

// FR-334..337: block+report, reachable at all times a conversation is
// open — the exact backend category enum (schema.prisma ReportReasonCategory),
// a required reason only for "Other" mirroring the backend's own
// conditional-required rule.
export function SafetySheet({
  matchId,
  onClose,
  onBlocked,
}: {
  matchId: string;
  onClose: () => void;
  onBlocked: () => void;
}) {
  const t = useTranslations("chat.safetySheet");
  const [step, setStep] = useState<Step>("menu");
  const [category, setCategory] = useState<ReportReasonCategory | null>(null);
  const [reason, setReason] = useState("");

  const blockMutation = useMutation({
    mutationFn: () => blockConversationPartner(matchId),
    onSuccess: onBlocked,
  });

  const reportMutation = useMutation({
    mutationFn: () =>
      reportConversationPartner(matchId, category!, reason.trim() || undefined),
    onSuccess: onClose,
  });

  // Same real bug/fix as elsewhere (docs/roadmap.md): both real backend
  // exceptions here (404 "Conversation not found.", 403 "Not a participant
  // in this conversation.") are essentially unreachable through normal UI
  // flow — the sheet only opens for an already-valid conversation — so
  // there's no specific expected case to special-case; anything real that
  // does happen gets the same safe generic fallback as every other fixed
  // site. Guarded on `isError` explicitly — getSafeErrorMessage always
  // returns *some* message, which would otherwise render persistently once
  // `error` is ever non-null, even after a later successful retry leaves
  // `error` populated but `isError` false (same bug already caught once in
  // date-share-sheet.tsx).
  const reportError = reportMutation.isError
    ? getSafeErrorMessage(reportMutation.error, []).detail
    : undefined;
  const blockError = blockMutation.isError
    ? getSafeErrorMessage(blockMutation.error, []).detail
    : undefined;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-[var(--bg-deep)]/70 sm:items-center">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-t-[var(--radius-lg-value)] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-elevation-3 sm:rounded-[var(--radius-lg-value)]">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <ShieldIcon className="h-5 w-5" />
            {t("title")}
          </h2>
          <button type="button" aria-label={t("close")} onClick={onClose}>
            <CloseIcon className="h-5 w-5 text-[var(--text-muted)]" />
          </button>
        </div>

        {step === "menu" ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setStep("report")}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left font-bold text-[var(--text)]"
            >
              {t("reportUser")}
            </button>
            <button
              type="button"
              onClick={() => setStep("block-confirm")}
              className="rounded-full border border-[var(--danger)] px-4 py-3 text-left font-bold text-[var(--danger)]"
            >
              {t("block")}
            </button>
          </div>
        ) : null}

        {step === "block-confirm" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-muted)]">
              {t("blockWarning")}
            </p>
            {blockError ? (
              <p className="text-sm text-[var(--danger)]">{blockError}</p>
            ) : null}
            <button
              type="button"
              onClick={() => blockMutation.mutate()}
              disabled={blockMutation.isPending}
              className="rounded-full bg-[var(--danger)] px-4 py-3 font-extrabold text-white shadow-elevation-cta-danger disabled:opacity-50 disabled:shadow-none"
            >
              {t("confirmBlock")}
            </button>
            <button
              type="button"
              onClick={() => setStep("menu")}
              className="text-center text-sm text-[var(--text-muted)] underline"
            >
              {t("cancel")}
            </button>
          </div>
        ) : null}

        {step === "report" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!category) return;
              reportMutation.mutate();
            }}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-2">
              {CATEGORY_VALUES.map((value) => (
                <label
                  key={value}
                  className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="report-category"
                    value={value}
                    checked={category === value}
                    onChange={() => setCategory(value)}
                  />
                  {t(`categories.${value}`)}
                </label>
              ))}
            </div>
            {category === "OTHER" ? (
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label={t("explanation")}
                placeholder={t("explanationPlaceholder")}
                required
                minLength={1}
                maxLength={500}
                className="min-h-20 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--text)]"
              />
            ) : null}
            {reportError ? (
              <p className="text-sm text-[var(--rose)]">{reportError}</p>
            ) : null}
            <button
              type="submit"
              disabled={
                !category ||
                (category === "OTHER" && !reason.trim()) ||
                reportMutation.isPending
              }
              className="rounded-full bg-[var(--turquoise)] px-4 py-3 font-extrabold text-[#04211f] shadow-elevation-cta-turquoise disabled:opacity-50 disabled:shadow-none"
            >
              {t("submitReport")}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
