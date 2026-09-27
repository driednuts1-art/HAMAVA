"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { HelpIcon, ShieldIcon } from "@/components/icons";

// Feature 22 FR-308/FR-315: the new "Support & Safety" section, between
// Notifications and Account (docs/requirements.md Feature 22 §5) — the
// first place either Help Center or a dedicated Safety page is reachable
// from anywhere other than inside an open conversation.
export function SupportSafetySection() {
  const t = useTranslations("settings.supportSafety");
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-extrabold text-[var(--text-faint)]">{t("heading")}</h2>
      <Link
        href="/settings/help"
        className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-3 font-bold text-[var(--text)] shadow-elevation-1"
      >
        <HelpIcon className="h-5 w-5 text-[var(--text-muted)]" />
        {t("helpCenter")}
      </Link>
      <Link
        href="/settings/safety"
        className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-3 font-bold text-[var(--text)] shadow-elevation-1"
      >
        <ShieldIcon className="h-5 w-5 text-[var(--text-muted)]" />
        {t("safety")}
      </Link>
    </section>
  );
}
