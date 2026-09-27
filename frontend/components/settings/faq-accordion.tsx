"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PlusIcon, CloseIcon } from "@/components/icons";

// Feature 22 FR-309: a fixed, hardcoded FAQ set — no backend call, matching
// the user's own explicit "fixed for now, real content replaces it later"
// framing. Real dating-app-relevant questions, not generic filler.
const FAQ_KEYS = ["aiSearch", "verified", "harassment", "deleteAccount", "support"] as const;

// FR-310: independently expandable (a plain accordion, not a single-open
// radio pattern — these are unrelated questions), keyboard-operable via the
// native APG disclosure pattern (a real <button aria-expanded> inside a
// real heading, not a styled <div>).
export function FaqAccordion() {
  const t = useTranslations("settings.faq");
  const [openIndexes, setOpenIndexes] = useState<Set<number>>(new Set());

  function toggle(i: number) {
    setOpenIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {FAQ_KEYS.map((key, i) => {
        const isOpen = openIndexes.has(i);
        return (
          <div
            key={key}
            className="rounded-[var(--radius-md-value)] border border-[var(--border)] bg-[var(--panel)] shadow-elevation-1"
          >
            <h3>
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-expanded={isOpen}
                aria-controls={`faq-panel-${i}`}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-bold text-[var(--text)]"
              >
                {t(`entries.${key}.question`)}
                {isOpen ? (
                  <CloseIcon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                ) : (
                  <PlusIcon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                )}
              </button>
            </h3>
            {isOpen ? (
              <p
                id={`faq-panel-${i}`}
                className="px-4 pb-3 text-sm text-[var(--text-muted)]"
              >
                {t(`entries.${key}.answer`)}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
