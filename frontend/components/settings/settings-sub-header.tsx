"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BackIcon } from "@/components/icons";

// Feature 22: the shared header for every new Settings sub-route
// (`/settings/help`, `/settings/safety`, `/settings/privacy-policy`,
// `/settings/terms`) — one real "back to Settings" affordance, matching
// `conversation-view.tsx`'s own established back-link pattern exactly,
// rather than four near-identical copies.
export function SettingsSubHeader({ title }: { title: string }) {
  const t = useTranslations("settings.subHeader");
  return (
    <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)] p-3">
      <Link href="/settings" aria-label={t("backToSettings")}>
        <BackIcon className="h-5 w-5 text-[var(--text-muted)]" />
      </Link>
      <h1 className="text-lg font-extrabold text-[var(--text)]">{title}</h1>
    </header>
  );
}
