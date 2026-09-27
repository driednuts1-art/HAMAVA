import { getTranslations } from "next-intl/server";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { ComingSoonPlaceholder } from "@/components/settings/coming-soon-placeholder";

// Feature 22 FR-312..314: see docs/requirements.md Feature 22 §1/§11 for why
// this is a placeholder — the named source file doesn't exist in this repo.
export default async function PrivacyPolicyPage() {
  const t = await getTranslations("settings");
  return (
    <main className="flex min-h-screen flex-col">
      <SettingsSubHeader title={t("legalLinks.privacyPolicy")} />
      <ComingSoonPlaceholder title={t("privacyPolicyPage.title")} />
    </main>
  );
}
