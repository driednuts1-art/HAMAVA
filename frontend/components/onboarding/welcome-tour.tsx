"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore } from "@/lib/auth-store";
import { markWelcomeTourSeen } from "@/lib/queries/profile";
import {
  VerifiedIcon,
  ChatIcon,
  CallIcon,
  ShareIcon,
  StarFilledIcon,
  BoltIcon,
} from "@/components/icons";

// Feature 29 (FR-506): exactly 4 slides, every claim mapping to an
// already-shipped feature — no invented copy, same discipline Feature 28's
// landing page already established. The signature gradient is deliberately
// never used anywhere here (docs/design-system.md §1.2's closed
// allowed-surfaces list does not include this moment, however tempting
// "first-time onboarding" makes it look).
//
// Icons only, not text — useTranslations() (a hook) can't run at module
// scope, so the title/detail strings are looked up inside the component.
const SLIDE_KEYS = ["welcome", "aiSearch", "safeConnection", "superLikeBoost"] as const;
const SLIDE_ICONS = [
  [VerifiedIcon],
  [ChatIcon],
  [CallIcon, ShareIcon],
  [StarFilledIcon, BoltIcon],
] as const;

export function WelcomeTour() {
  const t = useTranslations("onboarding.welcomeTour");
  const [index, setIndex] = useState(0);
  const setWelcomeTourSeen = useAuthStore((s) => s.setWelcomeTourSeen);
  const isLast = index === SLIDE_KEYS.length - 1;
  const slideKey = SLIDE_KEYS[index];
  const slideIcons = SLIDE_ICONS[index];

  const dismissMutation = useMutation({
    mutationFn: markWelcomeTourSeen,
    onSuccess: () => setWelcomeTourSeen(true),
    // FR-508: dismissed for the user either way — a real network hiccup on
    // this one-time marker must never trap them behind the overlay forever.
    // The store still flips locally; the next real profile save (or a
    // retry of this same mutation next session) will persist it for real.
    onError: () => setWelcomeTourSeen(true),
  });

  return (
    <div
      role="dialog"
      aria-label={t("ariaLabel")}
      className="fixed inset-0 z-50 flex flex-col justify-end bg-[var(--bg-deep)]/90 px-4 pb-8 pt-16 backdrop-blur-sm sm:items-center sm:justify-center"
    >
      <div className="mx-auto flex w-full max-w-sm flex-col gap-6 rounded-[var(--radius-lg-value)] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-elevation-3">
        <button
          type="button"
          onClick={() => dismissMutation.mutate()}
          className="self-start text-xs font-bold text-[var(--text-faint)]"
        >
          {t("dismiss")}
        </button>

        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="flex flex-col items-center gap-4 text-center"
          >
            <div className="flex gap-2">
              {slideIcons.map((Icon, i) => (
                <div
                  key={i}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--turquoise-dim)] text-[var(--turquoise)] shadow-elevation-2"
                >
                  <Icon className="h-6 w-6" />
                </div>
              ))}
            </div>
            <h2 className="text-lg font-extrabold text-[var(--text)]">{t(`slides.${slideKey}.title`)}</h2>
            <p className="text-sm text-[var(--text-muted)]">{t(`slides.${slideKey}.detail`)}</p>
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center justify-center gap-1.5">
          {SLIDE_KEYS.map((_, i) => (
            <span
              key={i}
              className={
                "h-1.5 rounded-full transition-all " +
                (i === index ? "w-5 bg-[var(--turquoise)]" : "w-1.5 bg-[var(--surface-2)]")
              }
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            if (isLast) {
              dismissMutation.mutate();
            } else {
              setIndex((i) => i + 1);
            }
          }}
          className="rounded-full bg-[var(--turquoise)] px-4 py-3 font-extrabold text-[#04211f] shadow-elevation-cta-turquoise"
        >
          {isLast ? t("letsGo") : t("next")}
        </button>
      </div>
    </div>
  );
}
