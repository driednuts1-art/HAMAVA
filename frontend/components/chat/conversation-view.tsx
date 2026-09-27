"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  useQueryClient,
  useInfiniteQuery,
  useMutation,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  getMessageHistory,
  sendMessage,
  markConversationRead,
  type Message,
  type MessageHistoryPage,
  type ConversationSummary,
} from "@/lib/queries/chat";
import {
  CONVERSATIONS_QUERY_KEY,
  messageHistoryQueryKey,
} from "@/lib/queries/chat-query-keys";
import { useLiveMessages, useChatConnectionStatus } from "@/lib/hooks/use-chat-socket";
import { useAuthStore } from "@/lib/auth-store";
import { useCallStore } from "@/lib/call-store";
import { startOutgoingCall } from "@/lib/webrtc";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ComposeBar } from "@/components/chat/compose-bar";
import { SafetySheet } from "@/components/chat/safety-sheet";
import { DateShareSheet } from "@/components/date-share/date-share-sheet";
import { MatchFeedback } from "@/components/matches/match-feedback";
import { BackIcon, ShieldIcon, VerifiedIcon, CallIcon, VideoIcon, ShareIcon } from "@/components/icons";
import { SkeletonLine, EmptyState } from "@/components/page-states";
import { PresenceDot, formatPresenceLabel } from "@/components/presence-indicator";

interface PendingMessage {
  clientIdempotencyKey: string;
  content: string;
  failed: boolean;
}

function randomUuid(): string {
  return crypto.randomUUID();
}

type HistoryData = InfiniteData<MessageHistoryPage, string | undefined>;

function prependMessage(old: HistoryData | undefined, message: Message): HistoryData | undefined {
  if (!old) return old;
  const pages = old.pages.slice();
  pages[0] = { ...pages[0], messages: [message, ...pages[0].messages] };
  return { ...old, pages };
}

// FR-321..329: message history (cursor-paginated, newest-first from the
// backend — reversed here for the conventional oldest-top/newest-bottom
// display), optimistic send with a real, reused idempotency key (FR-323),
// live delivery via the app-wide socket filtered to this matchId (FR-324),
// and the persistent safety sheet (FR-334..337).
export function ConversationView({
  matchId,
  otherUser,
  matchReasons,
  onBlocked,
}: {
  matchId: string;
  otherUser: ConversationSummary["otherUser"];
  matchReasons: string[];
  onBlocked: () => void;
}) {
  const t = useTranslations("chat.conversationView");
  // Reuses the safety-sheet's own "Safety" label — one heading, not a
  // second, drifting English copy for the same concept.
  const tSafety = useTranslations("chat.safetySheet");
  const myUserId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => messageHistoryQueryKey(matchId), [matchId]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [dateShareOpen, setDateShareOpen] = useState(false);
  const connectionStatus = useChatConnectionStatus();
  const callPhase = useCallStore((s) => s.phase);
  const callDisabled = callPhase !== "idle";

  const historyQuery = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      getMessageHistory(matchId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // Backend pages are newest-first; concatenated in fetch order the flat
  // list is still newest-first overall, so reverse once for display.
  const messages = useMemo(
    () => (historyQuery.data?.pages ?? []).flatMap((p) => p.messages).slice().reverse(),
    [historyQuery.data],
  );

  const sendMutation = useMutation({
    mutationFn: (input: { content: string; key: string }) =>
      sendMessage(matchId, input.content, input.key),
    onSuccess: (message) => {
      setPending((p) => p.filter((m) => m.clientIdempotencyKey !== message.clientIdempotencyKey));
      queryClient.setQueryData<HistoryData>(queryKey, (old) => prependMessage(old, message));
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
    },
    onError: (_err, input) => {
      setPending((p) =>
        p.map((m) =>
          m.clientIdempotencyKey === input.key ? { ...m, failed: true } : m,
        ),
      );
    },
  });

  function handleSend(content: string) {
    const key = randomUuid();
    setPending((p) => [...p, { clientIdempotencyKey: key, content, failed: false }]);
    sendMutation.mutate({ content, key });
  }

  function handleRetry(msg: PendingMessage) {
    setPending((p) =>
      p.map((m) =>
        m.clientIdempotencyKey === msg.clientIdempotencyKey ? { ...m, failed: false } : m,
      ),
    );
    sendMutation.mutate({ content: msg.content, key: msg.clientIdempotencyKey });
  }

  // FR-324: a live push for this matchId is appended and, since the screen
  // is open, immediately marked read.
  const onLiveMessage = useCallback(
    (message: Message) => {
      queryClient.setQueryData<HistoryData>(queryKey, (old) => prependMessage(old, message));
      if (message.senderId !== myUserId) {
        void markConversationRead(matchId).then(() =>
          queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY }),
        );
      }
    },
    [matchId, myUserId, queryClient, queryKey],
  );
  useLiveMessages(matchId, onLiveMessage);

  // FR-324 (initial mark-read on open) + scroll-to-bottom on first load and
  // on any newly-appended message.
  const prevMessageCount = useRef(0);
  useEffect(() => {
    void markConversationRead(matchId).then(() =>
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY }),
    );
    // Runs once per conversation open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    if (messages.length !== prevMessageCount.current) {
      prevMessageCount.current = messages.length;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // FR-321: scrolling to the top loads the next (older) page, preserving
  // the user's visual scroll position across the height change.
  function handleScroll() {
    const el = scrollRef.current;
    if (!el || el.scrollTop > 80) return;
    if (!historyQuery.hasNextPage || historyQuery.isFetchingNextPage) return;
    const prevHeight = el.scrollHeight;
    void historyQuery.fetchNextPage().then(() => {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop += scrollRef.current.scrollHeight - prevHeight;
        }
      });
    });
  }

  if (historyQuery.isPending) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
        <SkeletonLine className="h-10 w-2/3 self-start" />
        <SkeletonLine className="h-10 w-1/2 self-end" />
        <SkeletonLine className="h-10 w-3/5 self-start" />
      </div>
    );
  }

  // FR-329: 404 (nonexistent match, or the caller has blocked the other
  // side) is a real, distinct error — never treated as an empty conversation.
  if (historyQuery.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-bold text-[var(--text)]">{t("unavailable")}</p>
        <Link href="/matches" className="text-sm text-[var(--turquoise)] underline">
          {t("backToMatches")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)] p-3">
        <Link href="/matches" aria-label={t("back")}>
          <BackIcon className="h-5 w-5 text-[var(--text-muted)]" />
        </Link>
        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[var(--surface)]">
          {otherUser.primaryPhotoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- freshly-signed S3 URL */
            <img src={otherUser.primaryPhotoUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
          <PresenceDot presence={otherUser.presence} className="absolute -bottom-0.5 -start-0.5 h-3 w-3" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[var(--text)]">
              {otherUser.displayName ?? t("noName")}
            </span>
            {otherUser.verified ? (
              <VerifiedIcon className="h-3.5 w-3.5 text-[var(--turquoise)]" />
            ) : null}
          </div>
          {(() => {
            const label = formatPresenceLabel(otherUser.presence);
            return label && !otherUser.presence?.online ? (
              <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
            ) : null;
          })()}
        </div>
        {connectionStatus !== "connected" ? (
          <span
            aria-live="polite"
            className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]"
          >
            {connectionStatus === "connecting" ? t("connecting") : t("disconnected")}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={t("voiceCall")}
          disabled={callDisabled}
          onClick={() => void startOutgoingCall(matchId, "VOICE", otherUser)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] disabled:opacity-40"
        >
          <CallIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label={t("videoCall")}
          disabled={callDisabled}
          onClick={() => void startOutgoingCall(matchId, "VIDEO", otherUser)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] disabled:opacity-40"
        >
          <VideoIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label={t("shareDate")}
          onClick={() => setDateShareOpen(true)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)]"
        >
          <ShareIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label={tSafety("title")}
          onClick={() => setSafetyOpen(true)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)]"
        >
          <ShieldIcon className="h-5 w-5" />
        </button>
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex flex-1 flex-col gap-2 overflow-y-auto p-4"
      >
        {historyQuery.isFetchingNextPage ? (
          <SkeletonLine className="h-8 w-1/2 self-center" />
        ) : null}

        {messages.length === 0 && pending.length === 0 ? (
          // FR-327: a real, inviting first-message prompt — not the
          // generic empty state verbatim.
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              title={t("sendFirstMessage", { name: otherUser.displayName ?? t("them") })}
              detail={matchReasons[0]}
            />
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isOwn={message.senderId === myUserId}
            />
          ))
        )}

        {pending.map((p) => (
          <MessageBubble
            key={p.clientIdempotencyKey}
            message={{
              id: p.clientIdempotencyKey,
              matchId,
              senderId: myUserId ?? "",
              content: p.content,
              sentAt: new Date().toISOString(),
              readAt: null,
              clientIdempotencyKey: p.clientIdempotencyKey,
            }}
            isOwn
            failed={p.failed}
            onRetry={() => handleRetry(p)}
          />
        ))}
      </div>

      <MatchFeedback matchId={matchId} />
      <ComposeBar onSend={handleSend} disabled={sendMutation.isPending} />

      {safetyOpen ? (
        <SafetySheet
          matchId={matchId}
          onClose={() => setSafetyOpen(false)}
          onBlocked={() => {
            setSafetyOpen(false);
            onBlocked();
          }}
        />
      ) : null}

      {dateShareOpen ? (
        <DateShareSheet matchId={matchId} onClose={() => setDateShareOpen(false)} />
      ) : null}
    </div>
  );
}
