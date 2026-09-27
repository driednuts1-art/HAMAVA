"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { acceptBiometricConsent, startLivenessSession } from "@/lib/queries/auth";
import { VerifiedIcon, ShieldIcon } from "@/components/icons";
import { ErrorState } from "@/components/page-states";

// FR-218, Open Items #4: a placeholder — no product.md figure anchors this.
const MIN_VERIFYING_MS = 2500;

type Phase = "consent" | "verifying" | "failed";

export function LivenessStep({ onDone }: { onDone: () => void }) {
  const t = useTranslations("auth.liveness");
  const [phase, setPhase] = useState<Phase>("consent");

  const consentMutation = useMutation({
    mutationFn: acceptBiometricConsent,
    onSuccess: () => setPhase("verifying"),
  });

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5">
      {phase === "consent" ? (
        <ConsentPanel
          pending={consentMutation.isPending}
          error={consentMutation.isError}
          onAccept={() => consentMutation.mutate()}
        />
      ) : null}
      {phase === "verifying" ? (
        <VerifyingPanel
          onPass={onDone}
          onFail={() => setPhase("failed")}
        />
      ) : null}
      {phase === "failed" ? (
        <ErrorState
          title={t("failedTitle")}
          detail={t("failedDetail")}
          onRetry={() => setPhase("verifying")}
        />
      ) : null}
    </div>
  );
}

function ConsentPanel({
  pending,
  error,
  onAccept,
}: {
  pending: boolean;
  error: boolean;
  onAccept: () => void;
}) {
  const t = useTranslations("auth.liveness");
  return (
    <>
      <ShieldIcon className="h-10 w-10 text-[var(--turquoise)]" />
      <h1 className="text-center text-2xl font-extrabold tracking-[-0.01em]">
        {t("consentTitle")}
      </h1>
      {/* FR-217: plain statement of what this is, no pre-checked/implied consent. */}
      <p className="text-center text-sm leading-8 text-[var(--text-muted)]">
        {t("consentBody")}
      </p>
      {error ? <ErrorState onRetry={onAccept} /> : null}
      <button
        type="button"
        disabled={pending}
        onClick={onAccept}
        className="rounded-full bg-[var(--turquoise)] px-4 py-3 font-extrabold text-[#04211f] shadow-elevation-cta-turquoise disabled:opacity-50 disabled:shadow-none"
      >
        {pending ? t("accepting") : t("accept")}
      </button>
    </>
  );
}

function VerifyingPanel({
  onPass,
  onFail,
}: {
  onPass: () => void;
  onFail: () => void;
}) {
  const t = useTranslations("auth.liveness");
  const sessionMutation = useMutation({ mutationFn: startLivenessSession });

  useEffect(() => {
    let cancelled = false;
    const minWait = new Promise((resolve) =>
      setTimeout(resolve, MIN_VERIFYING_MS),
    );

    Promise.all([sessionMutation.mutateAsync(), minWait]).then(
      ([result]) => {
        if (cancelled) return;
        if (result.status === "PASS") onPass();
        else onFail();
      },
      () => {
        if (!cancelled) onFail();
      },
    );

    return () => {
      cancelled = true;
    };
    // Fires exactly once when this panel mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex h-36 w-36 items-center justify-center">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="var(--surface)"
            strokeWidth="6"
          />
          <motion.circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="var(--turquoise)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 44}
            initial={{ strokeDashoffset: 2 * Math.PI * 44 }}
            animate={{ strokeDashoffset: 0 }}
            transition={{ duration: MIN_VERIFYING_MS / 1000, ease: "linear" }}
          />
        </svg>
        <div className="absolute flex h-24 w-24 items-center justify-center rounded-full bg-[var(--surface)]">
          <VerifiedIcon className="h-8 w-8 text-[var(--turquoise)]" />
        </div>
      </div>
      <p className="text-center text-sm text-[var(--text-muted)]">
        {t("verifying")}
      </p>
    </div>
  );
}
