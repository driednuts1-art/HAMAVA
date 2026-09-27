"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";

// FR-317..320: docs/design-system.md §5's signature moment, load-bearing
// timings copied verbatim (slide-in 0-1.1s cubic-bezier(.2,.8,.2,1), burst
// 0.9-1.8s, text 1.3-1.9s) — the one place Display type + the signature
// gradient appear together, reserved exclusively for a real mutual match.
const SLIDE_EASE = [0.2, 0.8, 0.2, 1] as const;

export function MatchMoment({
  myPhotoUrl,
  otherPhotoUrl,
  matchReason,
  onDone,
}: {
  myPhotoUrl: string | null;
  otherPhotoUrl: string | null;
  matchReason: string | null;
  onDone: () => void;
}) {
  const t = useTranslations("matches.moment");
  return (
    // FR-319: skippable — a tap anywhere dismisses it, never a forced wait.
    <div
      role="dialog"
      aria-label={t("ariaLabel")}
      onClick={onDone}
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-8 bg-[var(--bg-deep)] px-6"
    >
      <div className="relative flex h-40 w-full max-w-xs items-center justify-center">
        <motion.svg
          viewBox="0 0 120 120"
          className="pointer-events-none absolute h-52 w-52"
          initial={{ scale: 0, opacity: 1 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ duration: 0.9, delay: 0.9, ease: "easeOut" }}
        >
          <defs>
            <linearGradient id="match-burst-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--turquoise)" />
              <stop offset="50%" stopColor="var(--gold)" />
              <stop offset="100%" stopColor="var(--rose)" />
            </linearGradient>
          </defs>
          <polygon
            points="60,10 88,35 88,85 60,110 32,85 32,35"
            fill="none"
            stroke="url(#match-burst-gradient)"
            strokeWidth={2}
          />
          <polygon
            points="60,32 76,44 76,76 60,88 44,76 44,44"
            fill="none"
            stroke="url(#match-burst-gradient)"
            strokeWidth={1.5}
          />
        </motion.svg>

        {/* RTL→LTR flip (docs/i18n-rtl-migration-scope.md §3.2): "my photo"
            stays the reading-start-side element (was right-2/slides from the
            right under dir="rtl"; now left-2/slides from the left under
            dir="ltr") — the composition intent (my photo leads) is
            preserved, only the physical side and slide-in direction flip. */}
        <motion.div
          className="absolute left-2 h-28 w-28 overflow-hidden rounded-full p-[3px]"
          style={{ background: "var(--signature-gradient)" }}
          initial={{ x: -90, rotate: 8, opacity: 0 }}
          animate={{ x: 0, rotate: 0, opacity: 1 }}
          transition={{ duration: 1.1, ease: SLIDE_EASE }}
        >
          <div className="h-full w-full overflow-hidden rounded-full bg-[var(--surface)]">
            {myPhotoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- freshly-signed S3 URL */
              <img src={myPhotoUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
        </motion.div>

        <motion.div
          className="absolute right-2 h-28 w-28 overflow-hidden rounded-full p-[3px]"
          style={{ background: "var(--signature-gradient)" }}
          initial={{ x: 90, rotate: -8, opacity: 0 }}
          animate={{ x: 0, rotate: 0, opacity: 1 }}
          transition={{ duration: 1.1, ease: SLIDE_EASE }}
        >
          <div className="h-full w-full overflow-hidden rounded-full bg-[var(--surface)]">
            {otherPhotoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- freshly-signed S3 URL */
              <img src={otherPhotoUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
        </motion.div>
      </div>

      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.3, ease: "easeOut" }}
        className="text-center font-black tracking-[-0.02em]"
        style={{
          fontSize: "clamp(32px, 6vw, 48px)",
          backgroundImage: "var(--signature-gradient-linear)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        In Harmony!
      </motion.h1>

      {matchReason ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 1.7 }}
          className="max-w-xs text-center text-sm text-[var(--text-muted)]"
        >
          {matchReason}
        </motion.p>
      ) : null}

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 1.9 }}
        className="text-xs text-[var(--text-muted)]"
      >
        {t("tapToContinue")}
      </motion.p>
    </div>
  );
}
