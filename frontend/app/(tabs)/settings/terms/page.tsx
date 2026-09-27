import { getTranslations } from "next-intl/server";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { ComingSoonPlaceholder } from "@/components/settings/coming-soon-placeholder";

// Feature 22 FR-312..314: no Terms of Service draft exists anywhere in this
// repo (docs/requirements.md Feature 22 §1) — same placeholder treatment as
// the Privacy Policy route.
export default async function TermsPage() {
  const t = await getTranslations("settings");
  return (
    <main className="flex min-h-screen flex-col">
      <SettingsSubHeader title={t("legalLinks.termsOfService")} />
      <ComingSoonPlaceholder title={t("termsPage.title")} />
    </main>
  );
}
