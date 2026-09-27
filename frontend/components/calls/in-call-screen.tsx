"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useCallStore } from "@/lib/call-store";
import { hangup, dismissEndedCall } from "@/lib/webrtc";
import { SafetySheet } from "@/components/chat/safety-sheet";
import { CallControls } from "@/components/calls/call-controls";
import { VerifiedIcon } from "@/components/icons";

function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    // No explicit reset-to-0 branch needed: InCallScreen returns null (and
    // fully unmounts) once a call ends, so this hook always gets a fresh
    // useState(0) on the next real call rather than reusing stale state.
    if (!active) {
      startRef.current = null;
      return;
    }
    startRef.current = Date.now();
    const interval = setInterval(() => {
      if (startRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [active]);

  return elapsed;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// FR-370: real 503s (TURN vendor down vs. a kill-switched call type) are
// only distinguishable by the real backend `detail` text — no fixed
// message per case here. Same for FR-371/372/373 (409/403/404/429): the
// real backend message is shown directly, never replaced with a generic
// one. Only genuinely client-originated states (no backend detail exists
// at all) get a fixed message — keys, not a module-level Persian record,
// since useTranslations() is a hook and can't run at module scope.
const CLIENT_ONLY_ERROR_KEYS: Record<string, string> = {
  "permission-denied": "permissionDenied",
  "connection-failed": "connectionFailed",
  declined: "declined",
  missed: "missed",
};

// FR-358..364: the real full-screen in-call UI — voice and video both,
// driven entirely by the real call-store/webrtc.ts state machine.
export function InCallScreen() {
  const t = useTranslations("calls.inCall");
  const tConversation = useTranslations("chat.conversationView");
  const phase = useCallStore((s) => s.phase);
  const type = useCallStore((s) => s.type);
  const otherUser = useCallStore((s) => s.otherUser);
  const localStream = useCallStore((s) => s.localStream);
  const remoteStream = useCallStore((s) => s.remoteStream);
  const error = useCallStore((s) => s.error);
  const matchId = useCallStore((s) => s.matchId);

  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const elapsed = useElapsedSeconds(phase === "active");

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  // FR-357: real track state, not a fake icon-only toggle.
  function toggleMute() {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }
  function toggleCamera() {
    const track = localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOff(!track.enabled);
  }

  useEffect(() => {
    if (phase !== "ended") return;
    const timeout = setTimeout(() => dismissEndedCall(), 2000);
    return () => clearTimeout(timeout);
  }, [phase]);

  if (phase === "idle") return null;

  const isVideo = type === "VIDEO";
  const statusText =
    phase === "ringing-outgoing"
      ? t("ringing")
      : phase === "connecting"
        ? t("connecting")
        : phase === "active"
          ? formatElapsed(elapsed)
          : phase === "ended"
            ? error
              ? (CLIENT_ONLY_ERROR_KEYS[error.kind] ? t(CLIENT_ONLY_ERROR_KEYS[error.kind]) : error.detail)
              : t("callEnded")
            : "";

  const avatarBlock = (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <div
        className="h-28 w-28 overflow-hidden rounded-full"
        style={
          otherUser?.verified
            ? { padding: 3, background: "var(--signature-gradient)" }
            : undefined
        }
      >
        <div className="h-full w-full overflow-hidden rounded-full bg-[var(--surface)]">
          {otherUser?.primaryPhotoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- freshly-signed S3 URL */
            <img src={otherUser.primaryPhotoUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <h1 className="text-xl font-extrabold text-[var(--text)]">
          {otherUser?.displayName ?? tConversation("noName")}
        </h1>
        {otherUser?.verified ? <VerifiedIcon className="h-4 w-4 text-[var(--turquoise)]" /> : null}
      </div>
    </div>
  );

  return (
    <div role="dialog" aria-label={t("ariaLabel")} className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-deep)]">
      {isVideo ? (
        <>
          {/* Mounted from the very start of a video call (not just once
              "active"), so the srcObject-binding effects below — keyed on
              [localStream]/[remoteStream], not on mount — actually fire
              while these nodes exist. Hidden via CSS, not conditional
              mounting, until the call is active. */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`absolute inset-0 h-full w-full object-cover ${phase === "active" ? "" : "hidden"}`}
          />
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`absolute right-4 top-4 h-32 w-24 rounded-xl border border-[var(--border)] object-cover ${phase === "active" ? "" : "hidden"}`}
          />
          {phase !== "active" ? avatarBlock : null}
        </>
      ) : (
        avatarBlock
      )}

      <div className="flex flex-col items-center gap-6 p-6">
        <p aria-live="polite" className="text-sm text-[var(--text-muted)]">
          {statusText}
        </p>
        {phase === "active" || phase === "connecting" || phase === "ringing-outgoing" ? (
          <CallControls
            muted={muted}
            onToggleMute={toggleMute}
            cameraOff={cameraOff}
            onToggleCamera={toggleCamera}
            showCameraToggle={isVideo}
            onHangup={hangup}
            onOpenSafety={() => setSafetyOpen(true)}
          />
        ) : null}
      </div>

      {safetyOpen && matchId ? (
        <SafetySheet
          matchId={matchId}
          onClose={() => setSafetyOpen(false)}
          onBlocked={() => {
            setSafetyOpen(false);
            hangup();
          }}
        />
      ) : null}
    </div>
  );
}
