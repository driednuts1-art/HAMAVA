"use client";

import { useTranslations } from "next-intl";
import { MicIcon } from "@/components/icons";
import type { VoiceRecordingStatus } from "@/lib/hooks/use-voice-recording";

/**
 * Feature 22 FR-318..324: the one shared three-state mic control both AI
 * Prompt Search (`ai-search.tsx`) and Conversational Profile Setup
 * (`conversational-setup.tsx`) render, instead of each call site
 * duplicating the same markup (§1 of docs/requirements.md Feature 22 found
 * both were byte-for-byte identical already).
 *
 * FR-321: a real, live "recording" animation (not a static color swap) and
 * a real, distinct "processing" state (spinner + visible text, not just a
 * dimmed disabled button). FR-319: the guidance hint and the processing
 * label share one floating bubble slot above the button — only one of them
 * can ever be true at once (recording vs. processing are mutually
 * exclusive states), so there is no real need for two separate elements.
 */
export function VoiceMicButton({
  status,
  hintVisible,
  hintText,
  onToggle,
}: {
  status: VoiceRecordingStatus;
  hintVisible: boolean;
  hintText: string;
  onToggle: () => void;
}) {
  const t = useTranslations("common.voiceMic");
  const bubbleText =
    status === "processing"
      ? t("processing")
      : status === "recording" && hintVisible
        ? hintText
        : null;

  return (
    <div className="relative">
      {bubbleText ? (
        <p
          role="status"
          // Feature 26 (Criterion I, real mobile-width finding): this
          // button sits near the real screen's right edge in both call
          // sites — a bubble *centered* on it (the original left-1/2
          // -translate-x-1/2) overflows past the real 375px viewport edge
          // and gets clipped, invisible on a desktop-width capture but
          // reproducible on a real phone. Anchored to the button's own
          // right edge instead, growing left into the screen's open space.
          className="pointer-events-none absolute bottom-full start-0 mb-4 w-max max-w-[12rem] rounded-[var(--radius-sm-value)] bg-[var(--panel)] px-3 py-1.5 text-center text-xs font-bold text-[var(--text)] shadow-lg"
        >
          {bubbleText}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        disabled={status === "processing"}
        aria-label={
          status === "recording"
            ? t("stopRecording")
            : status === "processing"
              ? t("processingShort")
              : t("startRecording")
        }
        aria-pressed={status === "recording"}
        className={
          "flex h-10 w-10 items-center justify-center rounded-full disabled:cursor-not-allowed " +
          (status === "recording"
            ? "mic-recording-pulse bg-[var(--rose)] text-[#2c0d16]"
            : status === "processing"
              ? "bg-[var(--surface)] text-[var(--turquoise)]"
              : "bg-[var(--surface)] text-[var(--text-muted)]")
        }
      >
        {status === "processing" ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <MicIcon className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
