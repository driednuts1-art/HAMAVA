"use client";

import { useTranslations } from "next-intl";
import { MicIcon, ShieldIcon, VideoIcon, CallIcon } from "@/components/icons";

// FR-359..361: real controls — mute/camera toggle real track.enabled,
// hangup always reachable, safety always reachable.
export function CallControls({
  muted,
  onToggleMute,
  cameraOff,
  onToggleCamera,
  showCameraToggle,
  onHangup,
  onOpenSafety,
}: {
  muted: boolean;
  onToggleMute: () => void;
  cameraOff: boolean;
  onToggleCamera: () => void;
  showCameraToggle: boolean;
  onHangup: () => void;
  onOpenSafety: () => void;
}) {
  const t = useTranslations("calls.controls");
  const tSafety = useTranslations("chat.safetySheet");
  return (
    <div className="flex items-center justify-center gap-5">
      <button
        type="button"
        aria-label={muted ? t("unmute") : t("mute")}
        aria-pressed={muted}
        onClick={onToggleMute}
        className={
          "flex h-14 w-14 items-center justify-center rounded-full " +
          (muted ? "bg-[var(--rose)] text-[#2c0d16]" : "bg-[var(--surface)] text-[var(--text)]")
        }
      >
        <MicIcon className="h-5 w-5" />
      </button>

      {showCameraToggle ? (
        <button
          type="button"
          aria-label={cameraOff ? t("cameraOn") : t("cameraOff")}
          aria-pressed={cameraOff}
          onClick={onToggleCamera}
          className={
            "flex h-14 w-14 items-center justify-center rounded-full " +
            (cameraOff ? "bg-[var(--rose)] text-[#2c0d16]" : "bg-[var(--surface)] text-[var(--text)]")
          }
        >
          <VideoIcon className="h-5 w-5" />
        </button>
      ) : null}

      <button
        type="button"
        aria-label={t("hangup")}
        onClick={onHangup}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rose)] text-[#2c0d16]"
      >
        <CallIcon className="h-6 w-6 rotate-[135deg]" />
      </button>

      <button
        type="button"
        aria-label={tSafety("title")}
        onClick={onOpenSafety}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text-muted)]"
      >
        <ShieldIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
