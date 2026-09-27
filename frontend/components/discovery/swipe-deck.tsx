"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { getDeck, swipe, type SwipeAction } from "@/lib/queries/discovery";
import { ApiRequestError } from "@/lib/api-error";
import { CandidateCard } from "@/components/discovery/candidate-card";
import { SkeletonLine, ErrorState, EmptyState } from "@/components/page-states";
import { CloseIcon, HeartIcon, StarIcon } from "@/components/icons";

export const DECK_QUERY_KEY = ["deck"];

/**
 * FR-259..FR-266: fetch, render, and act on the normal swipe deck.
 * Filters saving (FR-270) needs both a fresh server fetch and this
 * component's own local position back to the start — the parent
 * (`app/page.tsx`) resets the query and remounts this component via a
 * changing `key`, rather than this component syncing itself off a signal
 * prop through an effect (React's own "reset state on prop change" guidance
 * — the reset belongs in the event handler that causes it, not here).
 */
export function SwipeDeck({
  onMatched,
}: {
  onMatched: (matchId: string) => void;
}) {
  const t = useTranslations("discovery.swipeDeck");
  const [index, setIndex] = useState(0);
  const [rateLimited, setRateLimited] = useState<string | null>(null);

  const deckQuery = useInfiniteQuery({
    queryKey: DECK_QUERY_KEY,
    queryFn: ({ pageParam }) => getDeck(pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const candidates = deckQuery.data?.pages.flatMap((p) => p.candidates) ?? [];
  const active = candidates[index];

  useEffect(() => {
    if (
      candidates.length > 0 &&
      index >= candidates.length - 3 &&
      deckQuery.hasNextPage &&
      !deckQuery.isFetchingNextPage
    ) {
      void deckQuery.fetchNextPage();
    }
    // Only re-evaluate when the queue position or page count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, candidates.length, deckQuery.hasNextPage, deckQuery.isFetchingNextPage]);

  const swipeMutation = useMutation({
    mutationFn: ({ targetUserId, action }: { targetUserId: string; action: SwipeAction }) =>
      swipe(targetUserId, action),
    onSuccess: (result) => {
      setIndex((i) => i + 1);
      if (result.matched && result.matchId) onMatched(result.matchId);
    },
    onError: (err) => {
      // FR-264: a real 409 (already swiped) silently advances — not a
      // user-facing error, just an unlikely race (e.g. two tabs).
      if (err instanceof ApiRequestError && err.problem.status === 409) {
        setIndex((i) => i + 1);
        return;
      }
      // FR-265: a real 429 disables further taps with the real message,
      // rather than letting every further tap file its own doomed request.
      if (err instanceof ApiRequestError && err.problem.status === 429) {
        setRateLimited(err.problem.detail);
      }
    },
  });

  function act(action: SwipeAction) {
    if (!active || rateLimited) return;
    swipeMutation.mutate({ targetUserId: active.id, action });
  }

  if (deckQuery.isPending) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-3">
        <SkeletonLine className="aspect-[3/4] w-full rounded-[var(--radius-lg-value)]" />
      </div>
    );
  }

  if (deckQuery.isError) {
    return <ErrorState onRetry={() => deckQuery.refetch()} />;
  }

  if (!active) {
    // FR-266: a real, designed empty state — never a blank screen.
    return (
      <EmptyState
        title={t("emptyTitle")}
        detail={t("emptyDetail")}
      />
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <CandidateCard candidate={active} />

      {rateLimited ? (
        <p role="alert" className="text-center text-xs text-[var(--rose)]">
          {rateLimited}
        </p>
      ) : (
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            aria-label={t("pass")}
            onClick={() => act("PASS")}
            disabled={swipeMutation.isPending}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel)] text-[var(--text-muted)] shadow-elevation-1 disabled:opacity-50 disabled:shadow-none"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label={t("superLike")}
            onClick={() => act("SUPER_LIKE")}
            disabled={swipeMutation.isPending}
            className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-elevation-cta-rose disabled:opacity-50 disabled:shadow-none"
            style={{ background: "linear-gradient(135deg, var(--rose), #9c4c62)" }}
          >
            <StarIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label={t("like")}
            onClick={() => act("LIKE")}
            disabled={swipeMutation.isPending}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--turquoise)] text-[#04211f] shadow-elevation-cta-turquoise disabled:opacity-50 disabled:shadow-none"
          >
            <HeartIcon className="h-6 w-6" />
          </button>
        </div>
      )}
    </div>
  );
}
