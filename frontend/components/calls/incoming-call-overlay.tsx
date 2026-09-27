"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useCallStore } from "@/lib/call-store";
import { getConversations } from "@/lib/queries/chat";
import { CONVERSATIONS_QUERY_KEY } from "@/lib/queries/chat-query-keys";
import { acceptIncomingCall, declineIncomingCall } from "@/lib/webrtc";
import { CallIcon, VideoIcon, CloseIcon, VerifiedIcon } from "@/components/icons";

// FR-345: a real, full-screen overlay — the real caller's name/photo
// resolved from GET /v1/chat/conversations (the call:incoming payload only
// carries a bare fromUserId), mounted app-wide so it's visible from any
// tab, not just inside the relevant conversation.
export function IncomingCallOverlay() {
  const t = useTranslations("calls.incoming");
  const tConversation = useTranslations("chat.conversationView");
  const phase = useCallStore((s) => s.phase);
  const callType = useCallStore((s) => s.type);
  const otherUserId = useCallStore((s) => s.otherUser?.id);

  const conversationsQuery = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: getConversations,
    enabled: phase === "ringing-incoming",
  });

  if (phase !== "ringing-incoming") return null;

  const conversation = conversationsQuery.data?.find((c) => c.otherUser.id === otherUserId);
  const displayName = conversation?.otherUser.displayName ?? tConversation("noName");
  const photoUrl = conversation?.otherUser.primaryPhotoUrl ?? null;
  const verified = conversation?.otherUser.verified ?? false;

  return (
    <div
      role="dialog"
      aria-label={t("ariaLabel")}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[var(--bg-deep)] px-6"
    >
      <div
        className="h-32 w-32 overflow-hidden rounded-full"
        style={verified ? { padding: 3, background: "var(--signature-gradient)" } : undefined}
      >
        <div className="h-full w-full overflow-hidden rounded-full bg-[var(--surface)]">
          {photoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- freshly-signed S3 URL */
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <h1 className="text-xl font-extrabold text-[var(--text)]">{displayName}</h1>
        {verified ? <VerifiedIcon className="h-4 w-4 text-[var(--turquoise)]" /> : null}
      </div>
      <p aria-live="polite" className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
        {callType === "VIDEO" ? <VideoIcon className="h-4 w-4" /> : <CallIcon className="h-4 w-4" />}
        {callType === "VIDEO" ? t("incomingVideoCall") : t("incomingVoiceCall")}
      </p>
      <div className="mt-8 flex gap-10">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            aria-label={t("decline")}
            onClick={declineIncomingCall}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rose)] text-[#2c0d16]"
          >
            <CloseIcon className="h-6 w-6" />
          </button>
          <span className="text-xs text-[var(--text-muted)]">{t("decline")}</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            aria-label={t("answerCall")}
            onClick={() => void acceptIncomingCall()}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--turquoise)] text-[#04211f]"
          >
            <CallIcon className="h-6 w-6" />
          </button>
          <span className="text-xs text-[var(--text-muted)]">{t("answer")}</span>
        </div>
      </div>
    </div>
  );
}
