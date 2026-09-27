"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { getConversations, type ConversationSummary } from "@/lib/queries/chat";
import { getMatches, type MatchSummary } from "@/lib/queries/matches";
import {
  CONVERSATIONS_QUERY_KEY,
  MATCHES_QUERY_KEY,
} from "@/lib/queries/chat-query-keys";
import { VerifiedIcon } from "@/components/icons";
import { SkeletonLine, ErrorState, EmptyState } from "@/components/page-states";
import { formatRelativeTime } from "@/lib/relative-time";
import { PresenceDot } from "@/components/presence-indicator";
import type { PresenceValue } from "@/lib/queries/discovery";

interface MergedMatch {
  matchId: string;
  otherUser: ConversationSummary["otherUser"];
  lastMessage: ConversationSummary["lastMessage"];
  unreadCount: number;
  matchReasons: string[];
  matchedAt: string | null;
}

function MatchAvatar({
  url,
  verified,
  presence,
  size = 56,
}: {
  url: string | null;
  verified: boolean;
  presence?: PresenceValue | null;
  size?: number;
}) {
  return (
    // Feature 27 real finding: this wrapper previously also carried
    // overflow-hidden, which — combined with rounded-full clipping to a
    // circle, not just the bounding box — silently clipped away the ENTIRE
    // corner-positioned verified badge below, invisible since it was first
    // written (confirmed via a real DOM check: elementFromPoint at the
    // badge's own center never returned the badge itself). The inner div
    // already clips the photo image on its own, so the outer wrapper never
    // needed overflow-hidden at all — removing it fixes both the
    // pre-existing verified badge and this feature's new presence dot at
    // once, verified live via the same elementFromPoint check afterward.
    <div
      className="relative shrink-0 rounded-full"
      style={
        verified
          ? { width: size, height: size, padding: 2, background: "var(--signature-gradient)" }
          : { width: size, height: size }
      }
    >
      <div
        className="h-full w-full overflow-hidden rounded-full bg-[var(--surface)]"
      >
        {url ? (
          /* eslint-disable-next-line @next/next/no-img-element -- freshly-signed,
             short-lived S3 URL, same reasoning as candidate-card.tsx. */
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      {verified ? (
        <span
          className="absolute -bottom-0.5 -left-0.5 flex h-4 w-4 items-center justify-center rounded-full"
          style={{ background: "var(--signature-gradient)" }}
        >
          <VerifiedIcon className="h-2.5 w-2.5 text-[#04211f]" />
        </span>
      ) : null}
      {/* Feature 27 (FR-487): opposite corner from the verified badge so
          the two never collide. */}
      <PresenceDot presence={presence ?? null} className="absolute -top-0.5 -start-0.5 h-3 w-3" />
    </div>
  );
}

// FR-311..316: merges GET /v1/chat/conversations (authoritative for
// visibility — hides matches the caller blocked, has real photo URLs) with
// GET /v1/discovery/matches (has matchReasons/matchSource, no photo) keyed
// by matchId. See docs/requirements.md Feature 17 Open Items #3 for why
// /chat/conversations, not /matches, is the visibility authority.
export function MatchList() {
  const t = useTranslations("matches.list");
  const tConversation = useTranslations("chat.conversationView");
  const conversationsQuery = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: getConversations,
  });
  const matchesQuery = useQuery({
    queryKey: MATCHES_QUERY_KEY,
    queryFn: getMatches,
  });

  if (conversationsQuery.isPending || matchesQuery.isPending) {
    return (
      <div className="flex flex-col gap-3 px-4">
        <SkeletonLine className="h-16 w-full" />
        <SkeletonLine className="h-16 w-full" />
        <SkeletonLine className="h-16 w-full" />
      </div>
    );
  }

  if (conversationsQuery.isError || matchesQuery.isError) {
    return (
      <div className="px-4">
        <ErrorState
          onRetry={() => {
            void conversationsQuery.refetch();
            void matchesQuery.refetch();
          }}
        />
      </div>
    );
  }

  const matchesById = new Map<string, MatchSummary>(
    matchesQuery.data.map((m) => [m.matchId, m]),
  );

  const merged: MergedMatch[] = conversationsQuery.data.map((c) => {
    const match = matchesById.get(c.matchId);
    return {
      matchId: c.matchId,
      otherUser: c.otherUser,
      lastMessage: c.lastMessage,
      unreadCount: c.unreadCount,
      matchReasons: match?.matchReasons ?? [],
      matchedAt: match?.matchedAt ?? null,
    };
  });

  const newMatches = merged.filter((m) => m.lastMessage === null);
  const conversations = merged
    .filter((m) => m.lastMessage !== null)
    .sort(
      (a, b) =>
        new Date(b.lastMessage!.sentAt).getTime() -
        new Date(a.lastMessage!.sentAt).getTime(),
    );

  if (merged.length === 0) {
    return (
      <div className="px-4">
        <EmptyState
          title={t("emptyTitle")}
          detail={t("emptyDetail")}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {newMatches.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="px-4 text-sm font-bold text-[var(--text-muted)]">
            {t("newMatches")}
          </h2>
          <div className="flex gap-3 overflow-x-auto px-4 pb-1">
            {newMatches.map((m) => (
              <Link
                key={m.matchId}
                href={`/matches/${m.matchId}`}
                className="flex w-16 shrink-0 flex-col items-center gap-1 text-center"
              >
                <MatchAvatar url={m.otherUser.primaryPhotoUrl} verified={m.otherUser.verified} presence={m.otherUser.presence} />
                <span className="w-full truncate text-[11px] font-bold text-[var(--text)]">
                  {m.otherUser.displayName ?? tConversation("noName")}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5 px-4">
        {conversations.length > 0 ? (
          <h2 className="pb-1 text-sm font-bold text-[var(--text-muted)]">
            {t("messages")}
          </h2>
        ) : null}
        {conversations.map((m) => (
          <Link
            key={m.matchId}
            href={`/matches/${m.matchId}`}
            // Feature 26 (FR-478): docs/design-system.md §1.3's own
            // elevation table already names "match-list row" as a real
            // --elevation-1 example — inapplicable until the row had a real
            // card shape (the /matches layout fix just before this
            // feature). py-3 (not py-2.5) per the same feature's new §9
            // spacing scale — 10px was a real half-step exception, not a
            // second, competing value.
            className="flex items-center gap-3 rounded-2xl bg-[var(--panel)] px-3 py-3 shadow-elevation-1 active:bg-[var(--surface)]"
          >
            <MatchAvatar url={m.otherUser.primaryPhotoUrl} verified={m.otherUser.verified} presence={m.otherUser.presence} size={48} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-bold text-[var(--text)]">
                {m.otherUser.displayName ?? tConversation("noName")}
              </span>
              <span className="truncate text-sm text-[var(--text-muted)]">
                {m.lastMessage!.content}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-[11px] text-[var(--text-muted)]">
                {formatRelativeTime(m.lastMessage!.sentAt)}
              </span>
              {m.unreadCount > 0 ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--rose)] px-1.5 text-[11px] font-extrabold text-[#2c0d16]">
                  {m.unreadCount > 9 ? "9+" : m.unreadCount}
                </span>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
