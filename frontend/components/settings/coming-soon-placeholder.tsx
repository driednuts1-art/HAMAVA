"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DocumentIcon } from "@/components/icons";

// Feature 22 FR-313: the real content this links to (docs/hamava-privacy-policy-draft.md,
// as named by the user) does not exist in this repo yet, and neither does a
// real Terms of Service draft — confirmed directly (docs/requirements.md
// Feature 22 §1). Rather than a broken link or a silently-invented document,
// both routes render this honest, working placeholder — swapped for real
// raw-rendered content later is a contained change to those two route files
// alone (FR-314).
export function ComingSoonPlaceholder({ title }: { title: string }) {
  const t = useTranslations("settings.comingSoon");
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text-muted)] shadow-elevation-1">
        <DocumentIcon className="h-6 w-6" />
      </div>
      <p className="font-bold text-[var(--text)]">{title}</p>
      <p className="max-w-xs text-sm text-[var(--text-muted)]">
        {t("body")}
      </p>
      <Link
        href="/settings"
        className="rounded-full bg-[var(--turquoise)] px-4 py-2 text-sm font-extrabold text-[#04211f] shadow-elevation-cta-turquoise"
      >
        {t("backToSettings")}
      </Link>
    </div>
  );
}
