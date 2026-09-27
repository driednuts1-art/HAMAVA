import { getTranslations } from "next-intl/server";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";

// Feature 22 FR-315..317: real, concrete, feature-referencing guidance —
// not generic "be careful" filler — plus an honest, explicit acknowledgment
// of the real blocked-list backend gap (docs/requirements.md Feature 22 §1),
// rather than a safety page that quietly omits a control users may
// reasonably expect to find there.
const TIP_KEYS = ["publicPlace", "shareDetails", "videoCallFirst", "trustYourGut", "reportBlock"] as const;

export default async function SafetyPage() {
  const t = await getTranslations("settings.safety");
  return (
    <main className="flex min-h-screen flex-col">
      <SettingsSubHeader title={t("pageTitle")} />
      <div className="flex flex-col gap-4 p-4 pb-24">
        {TIP_KEYS.map((key) => (
          <div
            key={key}
            className="rounded-[var(--radius-md-value)] border border-[var(--border)] bg-[var(--panel)] p-4 shadow-elevation-1"
          >
            <p className="text-sm font-bold text-[var(--text)]">{t(`tips.${key}.title`)}</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{t(`tips.${key}.detail`)}</p>
          </div>
        ))}

        {/* FR-317: an explicit, honest acknowledgment of the real gap —
            found and documented, not built (docs/roadmap.md). */}
        <div className="rounded-[var(--radius-md-value)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-elevation-1">
          <p className="text-sm font-bold text-[var(--text)]">
            {t("noBlockListTitle")}
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {t("noBlockListDetail")}
          </p>
        </div>
      </div>
    </main>
  );
}
