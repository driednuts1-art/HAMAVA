"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import {
  startConversationalSetup,
  sendTextTurn,
  sendVoiceTurn,
  confirmField,
  endConversationalSetup,
  type TurnResult,
  type ConversationalField,
} from "@/lib/queries/conversational-setup";
import { getProfile } from "@/lib/queries/profile";
import { ApiRequestError } from "@/lib/api-error";
import { getSafeErrorMessage } from "@/lib/safe-error-message";
import { useAuthStore } from "@/lib/auth-store";
import { ProposalCard } from "@/components/profile/proposal-card";
import { SkeletonLine, ErrorState } from "@/components/page-states";
import { SendIcon } from "@/components/icons";
import { useVoiceRecording } from "@/lib/hooks/use-voice-recording";
import { VoiceMicButton } from "@/components/voice-mic-button";

interface TranscriptEntry {
  role: "assistant" | "user";
  text: string;
}

/**
 * FR-243..FR-250: session/transcript orchestration. `sessionId` lives only
 * in this component's own state (FR-243) — never useAuthStore, never
 * localStorage, mirroring the backend's Redis-only, no-Postgres-trace design.
 */
export function ConversationalSetup({
  onCompleted,
  onSwitchToManual,
}: {
  onCompleted: () => void;
  onSwitchToManual: () => void;
}) {
  const t = useTranslations("profile.conversationalSetup");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [pendingProposal, setPendingProposal] = useState<
    TurnResult["proposed"] | null
  >(null);
  const [textDraft, setTextDraft] = useState("");
  const [escapeHatchMessage, setEscapeHatchMessage] = useState<string | null>(
    null,
  );
  // FR-248: driven by the server's own remainingFields — starts non-empty
  // (see startMutation.onSuccess below) so the chat input renders during
  // the loading gap before the first real response, then reflects reality
  // exactly as each turn/confirm reports it.
  const [remainingFields, setRemainingFields] = useState<ConversationalField[]>(
    [],
  );
  const setProfileCompleted = useAuthStore((s) => s.setProfileCompleted);
  const setWelcomeTourSeen = useAuthStore((s) => s.setWelcomeTourSeen);
  const sessionIdRef = useRef<string | null>(null);

  const startMutation = useMutation({
    mutationFn: startConversationalSetup,
    onSuccess: (result) => {
      setSessionId(result.sessionId);
      sessionIdRef.current = result.sessionId;
      setTranscript([{ role: "assistant", text: result.assistantMessage }]);
      setRemainingFields(result.remainingFields);
    },
  });

  useEffect(() => {
    startMutation.mutate();
    // FR-250: abandon the session for real on unmount (navigate away),
    // rather than leaving it to expire silently on its own Redis TTL.
    return () => {
      if (sessionIdRef.current) {
        void endConversationalSetup(sessionIdRef.current);
      }
    };
    // Starts exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyTurnResult(result: TurnResult) {
    setTranscript((t) => [
      ...t,
      ...(result.transcript ? [{ role: "user" as const, text: result.transcript }] : []),
      { role: "assistant" as const, text: result.assistantReply },
    ]);
    setPendingProposal(result.proposed.field ? result.proposed : null);
    setRemainingFields(result.remainingFields);
  }

  // FR-245/FR-249: a real vendor failure (503) and the real turn-limit (409)
  // are handled identically, matching the backend's own messaging, which
  // already points at the manual-form escape hatch in both cases.
  function handleTurnError(err: unknown) {
    if (err instanceof ApiRequestError && (err.problem.status === 503 || err.problem.status === 409)) {
      setEscapeHatchMessage(err.problem.detail);
    }
  }

  const textTurnMutation = useMutation({
    mutationFn: (text: string) => sendTextTurn(sessionId!, text),
    onSuccess: applyTurnResult,
    onError: handleTurnError,
  });

  const voiceTurnMutation = useMutation({
    mutationFn: (blob: Blob) => sendVoiceTurn(sessionId!, blob),
    onSuccess: applyTurnResult,
    onError: handleTurnError,
  });

  const confirmMutation = useMutation({
    mutationFn: (value: Parameters<typeof confirmField>[1]) =>
      confirmField(sessionId!, value),
    onSuccess: async (result) => {
      setPendingProposal(null);
      setRemainingFields(result.remainingFields);
      // Re-fetch after *every* confirm, not only once the whole session
      // completes — a user can switch to the manual form mid-session
      // (FR-245/FR-249's escape hatch), and it must show whatever was
      // already confirmed, not stale pre-session data. A real gap caught
      // while writing this feature's own e2e test, not assumed away.
      const profile = await getProfile();
      setProfileCompleted(profile.profileCompletedAt !== null);
      setWelcomeTourSeen(profile.hasSeenWelcomeTour);
      onCompleted();

      if (result.completed) {
        // FR-248: driven by the server's own remainingFields/completed —
        // but "conversational complete" (5 fields) isn't necessarily
        // "profileCompletedAt set" (needs a photo too), which is exactly
        // why the profileCompleted set above already comes from the real
        // field (profile.profileCompletedAt), not the session's own notion
        // of done.
        if (sessionIdRef.current) {
          void endConversationalSetup(sessionIdRef.current);
          sessionIdRef.current = null;
        }
      }
    },
  });

  // Same real bug/fix as elsewhere (docs/roadmap.md): confirm() routes
  // through the same ProfileService.updateProfile() PATCH /v1/profile
  // itself uses (FR-140/141 above), so its one real, deliberate raw-text
  // exception is the identical bio-moderation 422 profile-form.tsx already
  // shows verbatim (`field: 'bio'`) — the only 422 reachable via the five
  // conversational fields (displayName/birthDate/city/bio/interests; only
  // bio is moderated). Anything else (an actually unexpected failure) gets
  // the same safe generic fallback as every other fixed site. Guarded on
  // `isError` explicitly — getSafeErrorMessage always returns *some*
  // message, which would otherwise persist into a later, unrelated
  // proposal once `confirmMutation.error` is ever non-null but before the
  // next `mutate()` call resets it (same bug already caught once in
  // date-share-sheet.tsx).
  const confirmError = confirmMutation.isError
    ? getSafeErrorMessage(confirmMutation.error, [{ status: 422 }]).detail
    : undefined;

  const recording = useVoiceRecording(
    (blob) => voiceTurnMutation.mutate(blob),
    voiceTurnMutation.isPending,
  );

  if (startMutation.isPending) {
    return (
      <div className="flex w-full max-w-md flex-col gap-3">
        <SkeletonLine className="h-6 w-2/3" />
        <SkeletonLine className="h-24 w-full" />
      </div>
    );
  }

  if (startMutation.isError) {
    return <ErrorState onRetry={() => startMutation.mutate()} />;
  }

  if (escapeHatchMessage) {
    return (
      <ErrorState title={t("continueManually")} detail={escapeHatchMessage} />
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {transcript.map((entry, i) => (
          <div
            key={i}
            className={
              entry.role === "assistant"
                ? "self-start rounded-2xl rounded-br-md bg-[var(--surface)] px-4 py-2 text-sm"
                : "self-end rounded-2xl rounded-bl-md bg-[var(--turquoise)] px-4 py-2 text-sm font-bold text-[#04211f]"
            }
          >
            {entry.text}
          </div>
        ))}
      </div>

      {pendingProposal ? (
        <ProposalCard
          proposed={pendingProposal}
          pending={confirmMutation.isPending}
          error={confirmError}
          onConfirm={(value) => confirmMutation.mutate(value)}
        />
      ) : remainingFields.length === 0 ? (
        // FR-248: a real "nothing left to ask" state, driven by the
        // server's own remainingFields — the chat input has no reason to
        // stay up once it's empty. A real gap caught while writing this
        // feature's own completion test: the conversational path can never
        // finish the profile alone (it never touches photos), so this
        // state's only real next step is the photo/manual screen.
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-lg-value)] border border-[var(--turquoise)] bg-[var(--panel)] p-4 text-center">
          <p className="text-sm font-bold text-[var(--turquoise)]">
            {t("almostDone")}
          </p>
          <button
            type="button"
            onClick={onSwitchToManual}
            className="rounded-full bg-[var(--turquoise)] px-4 py-2 text-sm font-extrabold text-[#04211f]"
          >
            {t("addPhoto")}
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (textDraft.trim()) {
              textTurnMutation.mutate(textDraft.trim());
              setTextDraft("");
            }
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            aria-label={t("messageAriaLabel")}
            disabled={textTurnMutation.isPending}
            className="flex-1 rounded-full border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--text)]"
          />
          <VoiceMicButton
            status={recording.status}
            hintVisible={recording.hintVisible}
            hintText={t("voiceHint")}
            onToggle={recording.toggle}
          />
          <button
            type="submit"
            disabled={textTurnMutation.isPending || !textDraft.trim()}
            aria-label={t("send")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--turquoise)] text-[#04211f] disabled:opacity-50"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </form>
      )}

      {remainingFields.length > 0 ? (
        <button
          type="button"
          onClick={onSwitchToManual}
          className="text-center text-xs text-[var(--text-muted)] underline"
        >
          {t("continueManually")}
        </button>
      ) : null}
    </div>
  );
}
