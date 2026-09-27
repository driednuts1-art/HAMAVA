"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  getWhoLikedMe,
  markWhoLikedMeSeen,
  swipe,
  WHO_LIKED_ME_COUNT_QUERY_KEY,
  WHO_LIKED_ME_QUERY_KEY,
  type DeckPage,
  type SwipeAction,
} from "@/lib/queries/discovery";
import { CandidateCard } from "@/components/discovery/candidate-card";
import { CloseIcon, HeartIcon, StarIcon } from "@/components/icons";
import { SkeletonLine, ErrorState, EmptyState } from "@/components/page-states";
import { MatchConfirmation } from "@/components/discovery/match-confirmation";

const LIMIT = 20;

/**
 * Feature 24 (FR-453..FR-461): the real people who liked the caller and
 * haven't been swiped back yet. FR-453: reuses the exact same, real
 * `CandidateCard` the deck and AI Search use — "a candidate has exactly one
 * visual language regardless of how they were found" (candidate-card.tsx's
 * own doc comment) is a real, deliberate constraint this tab honors too,
 * not a second, drifting compact card. FR-458: tapping like/super-like
 * always produces a real, instant match — `buildSafetyExclusionWhere()`
 * reused server-side (who-liked-me.service.ts) already guarantees every
 * listed person is someone the caller hasn't swiped — shown with the same,
 * existing `MatchConfirmation` (Feature 16) the deck itself uses, not
 * Feature 17's reserved MatchMoment (deliberately, per FR-458 and
 * match-confirmation.tsx's own scope note). FR-459: a real dismiss (PASS)
 * is also available, matching the deck's own pass semantics.
 */
export function WhoLikedMeList() {
  const t = useTranslations("discovery.whoLikedMe");
  const queryClient = useQueryClient();
  const [matched, setMatched] = useState(false);

  const listQuery = useInfiniteQuery({
    queryKey: WHO_LIKED_ME_QUERY_KEY,
    queryFn: ({ pageParam }) => getWhoLikedMe(pageParam as string | undefined, LIMIT),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // FR-463: mark the tab seen once, on open — resets the tab-bar badge.
  const markSeenMutation = useMutation({
    mutationFn: markWhoLikedMeSeen,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WHO_LIKED_ME_COUNT_QUERY_KEY });
    },
  });
  useEffect(() => {
    markSeenMutation.mutate();
    // Once per mount only — not on every re-render this effect could
    // otherwise re-fire on (e.g. a parent re-render passing a new object).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const swipeMutation = useMutation({
    mutationFn: ({ targetUserId, action }: { targetUserId: string; action: SwipeAction }) =>
      swipe(targetUserId, action),
    onSuccess: (result, variables) => {
      // FR-458/459/461: a real swipe was just recorded either way (like,
      // super-like, or pass) — this person no longer belongs in "not yet
      // swiped back," and per FR-459 a dismissed candidate never reappears
      // (buildSafetyExclusionWhere's own already-swiped exclusion, reused).
      queryClient.setQueryData<InfiniteData<DeckPage>>(WHO_LIKED_ME_QUERY_KEY, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                candidates: page.candidates.filter((c) => c.id !== variables.targetUserId),
              })),
            }
          : data,
      );
      if (result.matched) {
        setMatched(true);
      }
    },
  });

  function act(targetUserId: string, action: SwipeAction) {
    if (swipeMutation.isPending) return;
    swipeMutation.mutate({ targetUserId, action });
  }

  if (listQuery.isPending) {
    return (
      <div className="flex flex-col gap-4 px-4">
        <SkeletonLine className="aspect-[3/4] w-full rounded-[var(--radius-lg-value)]" />
      </div>
    );
  }

  if (listQuery.isError) {
    return (
      <div className="px-4">
        <ErrorState onRetry={() => listQuery.refetch()} />
      </div>
    );
  }

  const candidates = listQuery.data.pages.flatMap((p) => p.candidates);

  if (candidates.length === 0) {
    return (
      <div className="px-4">
        <EmptyState
          title={t("emptyTitle")}
          detail={t("emptyDetail")}
        />
        {/* A match on the very last card empties the list on this same
            render — the confirmation must still show, not vanish under it. */}
        {matched ? <MatchConfirmation onClose={() => setMatched(false)} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 px-4">
      {candidates.map((c) => {
        const isPendingThis =
          swipeMutation.isPending && swipeMutation.variables?.targetUserId === c.id;
        return (
          <div key={c.id} className="flex w-full max-w-sm flex-col items-center gap-3">
            <CandidateCard candidate={c} />
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                aria-label={t("pass")}
                disabled={swipeMutation.isPending}
                onClick={() => act(c.id, "PASS")}
                className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel)] text-[var(--text-muted)] shadow-elevation-1 disabled:opacity-50 disabled:shadow-none"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label={t("superLike")}
                disabled={swipeMutation.isPending}
                onClick={() => act(c.id, "SUPER_LIKE")}
                className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-elevation-cta-rose disabled:opacity-50 disabled:shadow-none"
                style={{ background: "linear-gradient(135deg, var(--rose), #9c4c62)" }}
              >
                <StarIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label={t("likeBack")}
                disabled={swipeMutation.isPending}
                onClick={() => act(c.id, "LIKE")}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--turquoise)] text-[#04211f] shadow-elevation-cta-turquoise disabled:opacity-50 disabled:shadow-none"
              >
                <HeartIcon className="h-6 w-6" />
              </button>
            </div>
            {isPendingThis ? (
              <SkeletonLine className="h-2 w-24 rounded-full" />
            ) : null}
          </div>
        );
      })}

      {listQuery.hasNextPage ? (
        <button
          type="button"
          onClick={() => listQuery.fetchNextPage()}
          disabled={listQuery.isFetchingNextPage}
          className="w-full max-w-sm rounded-full bg-[var(--surface)] px-4 py-2.5 text-sm font-extrabold text-[var(--text-muted)] disabled:opacity-50"
        >
          {listQuery.isFetchingNextPage ? t("loading") : t("showMore")}
        </button>
      ) : null}

      {matched ? <MatchConfirmation onClose={() => setMatched(false)} /> : null}
    </div>
  );
}
