"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activateBoost, getBoostStatus } from "@/lib/queries/discovery";
import { ApiRequestError } from "@/lib/api-error";
import { BoltIcon } from "@/components/icons";

const BOOST_QUERY_KEY = ["boost"];

function minutesRemaining(endsAt: string): number {
  return Math.max(0, Math.round((new Date(endsAt).getTime() - Date.now()) / 60000));
}

/** FR-279..FR-282: real status/activation, no client-guessed duration or limits. */
export function BoostBanner() {
  const t = useTranslations("discovery.boostBanner");
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const statusQuery = useQuery({ queryKey: BOOST_QUERY_KEY, queryFn: getBoostStatus });

  // Re-render the countdown every 30s while a boost is active — display
  // only, the real "active" truth always comes from a fresh fetch.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!statusQuery.data?.active) return;
    const id = setInterval(() => forceTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [statusQuery.data?.active]);

  const activateMutation = useMutation({
    mutationFn: activateBoost,
    onSuccess: (status) => {
      setErrorMessage(null);
      queryClient.setQueryData(BOOST_QUERY_KEY, status);
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.problem.status === 409) {
        // FR-281: already active is a no-op success, not a user-facing error.
        setErrorMessage(null);
        void queryClient.invalidateQueries({ queryKey: BOOST_QUERY_KEY });
        return;
      }
      if (err instanceof ApiRequestError && err.problem.status === 429) {
        setErrorMessage(err.problem.detail);
      }
    },
  });

  if (statusQuery.isPending || statusQuery.isError || !statusQuery.data) return null;

  if (statusQuery.data.active && statusQuery.data.endsAt) {
    return (
      <div
        className="flex items-center gap-3 rounded-[var(--radius-md-value)] border px-3 py-2.5"
        style={{
          background: "linear-gradient(90deg, var(--gold-dim), transparent)",
          borderColor: "rgba(227,177,85,.35)",
        }}
      >
        <BoltIcon className="h-4 w-4 flex-shrink-0 text-[var(--gold)]" />
        <div className="flex-1">
          <p className="text-xs font-extrabold">{t("active")}</p>
          <p className="text-[10px] font-semibold text-[var(--text-faint)]">
            {t("minutesLeft", { minutes: minutesRemaining(statusQuery.data.endsAt) })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => activateMutation.mutate()}
        disabled={activateMutation.isPending}
        className="flex items-center gap-2 rounded-[var(--radius-md-value)] border px-3 py-2.5 text-left disabled:opacity-50"
        style={{ borderColor: "rgba(227,177,85,.35)" }}
      >
        <BoltIcon className="h-4 w-4 flex-shrink-0 text-[var(--gold)]" />
        <span className="text-xs font-extrabold text-[var(--gold)]">
          {activateMutation.isPending ? t("activating") : t("activate")}
        </span>
      </button>
      {errorMessage ? (
        <p role="alert" className="text-xs text-[var(--rose)]">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
