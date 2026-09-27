"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DocumentIcon } from "@/components/icons";

// Feature 22 FR-312: informational, non-destructive — deliberately not
// grouped with Logout/Delete Account (docs/requirements.md Feature 22 §6.3).
export function LegalLinksRow() {
  const t = useTranslations("settings.legalLinks");
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-extrabold text-[var(--text-faint)]">{t("heading")}</h2>
      <Link
        href="/settings/privacy-policy"
        className="flex items-center gap-3 rounded-full border border-[var(--border)] px-4 py-3 text-sm font-bold text-[var(--text)] shadow-elevation-1"
      >
        <DocumentIcon className="h-4 w-4 text-[var(--text-muted)]" />
        {t("privacyPolicy")}
      </Link>
      <Link
        href="/settings/terms"
        className="flex items-center gap-3 rounded-full border border-[var(--border)] px-4 py-3 text-sm font-bold text-[var(--text)] shadow-elevation-1"
      >
        <DocumentIcon className="h-4 w-4 text-[var(--text-muted)]" />
        {t("termsOfService")}
      </Link>
    </div>
  );
}
