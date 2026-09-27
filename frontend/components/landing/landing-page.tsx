"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { BrandMark } from "@/components/brand-mark";
import {
  VerifiedIcon,
  ChatIcon,
  CallIcon,
  ShareIcon,
  ShieldIcon,
} from "@/components/icons";

// Feature 28: structural inspiration from bumble.com/de's section flow and
// persuasion order only — every color/radius/glow/font stays exactly what
// docs/design-system.md already defines; the signature gradient is
// deliberately NOT used anywhere below beyond BrandMark itself (§1.2's own
// closed allowed-surfaces list does not include a marketing page).

const FADE_UP = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

function Section({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={FADE_UP}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

// Icons only, not text — useTranslations() (a hook) can't run at module
// scope, so title/detail strings are looked up inside the component.
const BENEFIT_KEYS = ["liveVerification", "aiSearch", "safeVoiceCall", "dateShare"] as const;
const BENEFIT_ICONS = [VerifiedIcon, ChatIcon, CallIcon, ShareIcon] as const;

const STEP_KEYS = ["signUp", "verify", "discover", "connect"] as const;

export function LandingPage() {
  const t = useTranslations("landing");
  // Reuses the existing Privacy Policy / Terms of Service labels instead of
  // a third, drifting copy of the same two English strings.
  const tSettings = useTranslations("settings");
  return (
    <main className="flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-4 py-12 sm:gap-16 sm:py-16">
        {/* Hero */}
        <Section className="flex flex-col items-center gap-6 text-center">
          <BrandMark size={56} />
          <h1 className="max-w-lg text-[clamp(22px,3vw,28px)] font-extrabold leading-snug tracking-[-0.01em] text-[var(--text)]">
            {t("hero.title")}
          </h1>
          <p className="max-w-md text-sm text-[var(--text-muted)] sm:text-base">
            {t("hero.subtitle")}
          </p>
          <Link
            href="/login"
            className="rounded-full bg-[var(--turquoise)] px-8 py-3 text-base font-extrabold text-[#04211f] shadow-elevation-cta-turquoise"
          >
            {t("getStarted")}
          </Link>
        </Section>

        {/* Benefits */}
        <Section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFIT_KEYS.map((key, i) => {
            const Icon = BENEFIT_ICONS[i];
            return (
              <div
                key={key}
                className="flex flex-col gap-3 rounded-[var(--radius-lg-value)] border border-[var(--border)] bg-[var(--panel)] p-4 shadow-elevation-1"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--turquoise-dim)] text-[var(--turquoise)]">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="text-sm font-extrabold text-[var(--text)]">{t(`benefits.${key}.title`)}</h2>
                <p className="text-xs text-[var(--text-muted)]">{t(`benefits.${key}.detail`)}</p>
              </div>
            );
          })}
        </Section>

        {/* Trust / safety — separate and visually distinct, gold-accented
            per the palette's own "premium/highlight" role for --gold, not
            reused elevation-3 (reserved for overlays/modals per §1.3). */}
        <Section
          className="flex flex-col items-center gap-4 rounded-[var(--radius-lg-value)] border border-[var(--gold)]/30 bg-[var(--gold-dim)] p-6 text-center shadow-elevation-1 sm:p-8"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--gold)] text-[#3a2a08]">
            <ShieldIcon className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-extrabold text-[var(--text)]">
            {t("trust.title")}
          </h2>
          <p className="max-w-md text-sm text-[var(--text-muted)]">
            {t("trust.detail")}
          </p>
        </Section>

        {/* How it works */}
        <Section className="flex flex-col gap-6">
          <h2 className="text-center text-lg font-extrabold text-[var(--text)]">
            {t("howItWorks.title")}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEP_KEYS.map((key, i) => (
              <div
                key={key}
                className="flex flex-col gap-2 rounded-[var(--radius-lg-value)] border border-[var(--border)] bg-[var(--panel)] p-4"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--turquoise)] text-xs font-extrabold text-[#04211f]">
                  {i + 1}
                </span>
                <h3 className="text-sm font-extrabold text-[var(--text)]">{t(`steps.${key}.title`)}</h3>
                <p className="text-xs text-[var(--text-muted)]">{t(`steps.${key}.detail`)}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Second CTA, echoing the hero's own — a real, common landing-page
            pattern (bumble.com/de repeats its own CTA at the page's end),
            not a new control. */}
        <Section className="flex justify-center">
          <Link
            href="/login"
            className="rounded-full bg-[var(--turquoise)] px-8 py-3 text-base font-extrabold text-[#04211f] shadow-elevation-cta-turquoise"
          >
            {t("getStarted")}
          </Link>
        </Section>
      </div>

      {/* Footer */}
      <footer className="mt-auto border-t border-[var(--border)] px-4 py-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-3 text-xs text-[var(--text-faint)] sm:flex-row sm:justify-between">
          <span>{t("footerCopyright")}</span>
          <nav className="flex gap-4">
            <Link href="/settings/privacy-policy" className="hover:text-[var(--text-muted)]">
              {tSettings("legalLinks.privacyPolicy")}
            </Link>
            <Link href="/settings/terms" className="hover:text-[var(--text-muted)]">
              {tSettings("legalLinks.termsOfService")}
            </Link>
            <Link href="/settings/help" className="hover:text-[var(--text-muted)]">
              {t("contactUs")}
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
