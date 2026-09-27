"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getConversations } from "@/lib/queries/chat";
import { getMatches } from "@/lib/queries/matches";
import { getProfile, PROFILE_QUERY_KEY } from "@/lib/queries/profile";
import {
  CONVERSATIONS_QUERY_KEY,
  MATCHES_QUERY_KEY,
} from "@/lib/queries/chat-query-keys";
import { ConversationView } from "@/components/chat/conversation-view";
import { MatchMoment } from "@/components/matches/match-moment";
import { SkeletonLine } from "@/components/page-states";
import { hasSeenMatch, markMatchSeen } from "@/lib/seen-matches";

// FR-317..320: the match-moment gate — plays once per matchId (localStorage,
// FR-317), then reveals the real conversation underneath (FR-321..329).
export default function MatchDetailPage() {
  const params = useParams<{ matchId: string }>();
  // Keyed explicitly on matchId: navigating from one match straight to
  // another (both matching this same [matchId] route) is not guaranteed to
  // remount the page component on its own, but this route's local state
  // (showMoment below) is meaningless carried over from a different match —
  // an explicit key forces a fresh mount, and with it a fresh lazy-init
  // read of localStorage for the new matchId.
  return <MatchDetailPageInner key={params.matchId} matchId={params.matchId} />;
}

function MatchDetailPageInner({ matchId }: { matchId: string }) {
  const t = useTranslations("matches.detailPage");
  const tConversation = useTranslations("chat.conversationView");
  const router = useRouter();
  // A lazy initializer, not an effect: this is a one-time read of a stable
  // client-only source (localStorage) on first render, not a subscription
  // to an external system that needs to re-sync on every matchId change —
  // Next.js remounts this component on route-param navigation, so a fresh
  // initializer run per matchId is already guaranteed.
  const [showMoment, setShowMoment] = useState<boolean | null>(() =>
    typeof window === "undefined" ? null : !hasSeenMatch(matchId),
  );

  const conversationsQuery = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: getConversations,
  });
  const matchesQuery = useQuery({
    queryKey: MATCHES_QUERY_KEY,
    queryFn: getMatches,
  });
  const myProfileQuery = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: getProfile,
  });

  if (
    conversationsQuery.isPending ||
    matchesQuery.isPending ||
    myProfileQuery.isPending ||
    showMoment === null
  ) {
    return (
      <div className="flex min-h-screen flex-col gap-3 p-4">
        <SkeletonLine className="h-10 w-full" />
        <SkeletonLine className="h-16 w-3/4" />
      </div>
    );
  }

  const conversation = conversationsQuery.data?.find((c) => c.matchId === matchId);
  const match = matchesQuery.data?.find((m) => m.matchId === matchId);

  if (!conversation) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-bold text-[var(--text)]">{t("unavailable")}</p>
        <button
          type="button"
          onClick={() => router.replace("/matches")}
          className="text-sm text-[var(--turquoise)] underline"
        >
          {tConversation("backToMatches")}
        </button>
      </div>
    );
  }

  if (showMoment) {
    const myPhotos = myProfileQuery.data?.photos ?? [];
    const myPhotoUrl = myPhotos.slice().sort((a, b) => a.position - b.position)[0]?.url ?? null;
    return (
      <MatchMoment
        myPhotoUrl={myPhotoUrl}
        otherPhotoUrl={conversation.otherUser.primaryPhotoUrl}
        matchReason={match?.matchReasons[0] ?? null}
        onDone={() => {
          markMatchSeen(matchId);
          setShowMoment(false);
        }}
      />
    );
  }

  return (
    <ConversationView
      matchId={matchId}
      otherUser={conversation.otherUser}
      matchReasons={match?.matchReasons ?? []}
      onBlocked={() => router.replace("/matches")}
    />
  );
}
