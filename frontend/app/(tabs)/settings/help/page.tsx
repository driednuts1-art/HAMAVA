import { getTranslations } from "next-intl/server";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { FaqAccordion } from "@/components/settings/faq-accordion";

// Feature 22 FR-308..310.
export default async function HelpCenterPage() {
  const t = await getTranslations("settings.supportSafety");
  return (
    <main className="flex min-h-screen flex-col">
      <SettingsSubHeader title={t("helpCenter")} />
      <div className="flex flex-col gap-4 p-4 pb-24">
        <FaqAccordion />
      </div>
    </main>
  );
}
