"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/lib/queries/settings";
import { SETTINGS_QUERY_KEY } from "@/lib/queries/settings-query-keys";
import { PrivacySection } from "@/components/settings/privacy-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { SupportSafetySection } from "@/components/settings/support-safety-section";
import { LegalLinksRow } from "@/components/settings/legal-links-row";
import { LogoutButton } from "@/components/settings/logout-button";
import { DeleteAccountFlow } from "@/components/settings/delete-account-flow";
import { SkeletonLine, ErrorState } from "@/components/page-states";

// FR-402..423: one single scrollable page (Privacy / Notifications /
// Account), not sub-routes — see docs/requirements.md Feature 20 §11 Open
// Items #1 for why.
export default function SettingsPage() {
  const t = useTranslations("settings.page");
  const query = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: getSettings,
  });

  return (
    <main className="flex min-h-screen flex-col gap-8 p-4 pb-24">
      <h1 className="text-xl font-extrabold text-[var(--text)]">{t("title")}</h1>

      {query.isPending ? (
        <div className="flex flex-col gap-3">
          <SkeletonLine className="h-6 w-1/3" />
          <SkeletonLine className="h-10 w-full" />
          <SkeletonLine className="h-10 w-full" />
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : null}

      {query.data ? (
        <>
          <PrivacySection settings={query.data} />
          <NotificationsSection settings={query.data} />
          <SupportSafetySection />

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-extrabold text-[var(--text-faint)]">{t("account")}</h2>
            <LegalLinksRow />
            <LogoutButton />
            <DeleteAccountFlow />
          </section>
        </>
      ) : null}
    </main>
  );
}
