"use client";

import { useTranslations } from "next-intl";
import { HeartFilledIcon } from "@/components/icons";

/**
 * Open Items #3 (Feature 16): a real but deliberately simple confirmation —
 * confirms a real match happened, without borrowing Feature 17's reserved
 * signature match-moment (docs/design-system.md §5: photo-frame
 * convergence, girih burst, Display-weight type). This deck only ever
 * knows `matched: true`/`matchId` — not the other person's name or a real
 * "چرا شما دوتا؟", which is what would make that fuller moment earned
 * rather than premature. Feature 17 owns the real thing.
 */
export function MatchConfirmation({ onClose }: { onClose: () => void }) {
  const t = useTranslations("discovery.matchConfirmation");
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-[var(--bg-deep)]/85"
      role="alertdialog"
      aria-label={t("ariaLabel")}
    >
      <div className="flex flex-col items-center gap-4 rounded-[var(--radius-lg-value)] border border-[var(--turquoise)] bg-[var(--panel)] p-8 text-center shadow-elevation-3">
        <HeartFilledIcon className="h-10 w-10 text-[var(--rose)]" />
        <h2 className="text-xl font-extrabold tracking-[-0.01em]">{t("title")}</h2>
        <p className="max-w-xs text-sm text-[var(--text-muted)]">
          {t("body")}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-[var(--turquoise)] px-5 py-2.5 text-sm font-extrabold text-[#04211f] shadow-elevation-cta-turquoise"
        >
          {t("ok")}
        </button>
      </div>
    </div>
  );
}
