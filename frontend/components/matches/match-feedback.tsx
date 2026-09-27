"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMatchFeedback,
  submitMatchFeedback,
  type MatchFeedbackRating,
} from "@/lib/queries/matches";
import { HeartFilledIcon } from "@/components/icons";

const RATING_VALUES: MatchFeedbackRating[] = [
  "VERY_RELEVANT",
  "RELEVANT",
  "NEUTRAL",
  "NOT_RELEVANT",
  "WRONG_MATCH",
];

function feedbackQueryKey(matchId: string) {
  return ["discovery", "matches", matchId, "feedback"];
}

// FR-338/339: entirely optional, never blocking, never re-prompted once
// already rated (docs/requirements.md Feature 21's own "instrument, don't
// gate" framing for this endpoint).
export function MatchFeedback({ matchId }: { matchId: string }) {
  const t = useTranslations("matches.feedback");
  const queryClient = useQueryClient();
  const queryKey = feedbackQueryKey(matchId);

  const feedbackQuery = useQuery({
    queryKey,
    queryFn: () => getMatchFeedback(matchId),
  });

  const submitMutation = useMutation({
    mutationFn: (rating: MatchFeedbackRating) =>
      submitMatchFeedback(matchId, rating),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
    },
  });

  if (feedbackQuery.isPending) return null;

  if (feedbackQuery.data) {
    const ratedLabel = RATING_VALUES.includes(feedbackQuery.data.rating)
      ? t(`ratings.${feedbackQuery.data.rating}`)
      : feedbackQuery.data.rating;
    return (
      <p className="flex items-center justify-center gap-1.5 py-2 text-xs text-[var(--text-muted)]">
        <HeartFilledIcon className="h-3.5 w-3.5 text-[var(--turquoise)]" />
        {t("recorded", { rating: ratedLabel })}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <p className="text-xs text-[var(--text-muted)]">{t("prompt")}</p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {RATING_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            disabled={submitMutation.isPending}
            onClick={() => submitMutation.mutate(value)}
            className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-muted)] disabled:opacity-50"
          >
            {t(`ratings.${value}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
