import { useEffect, useRef, useState } from "react";

export type VoiceRecordingStatus = "idle" | "recording" | "processing";

// Feature 22 FR-319: how long the pre-recording guidance hint stays visible
// once recording starts (or until recording stops first, whichever is
// sooner) — a placeholder, not a data-driven figure (docs/requirements.md
// Feature 22 §11 Open Items #3), matching this project's own established
// precedent for this exact kind of UX-timing constant.
const HINT_VISIBLE_MS = 4000;

/**
 * A real, explicit, keyboard-triggerable start/stop — never auto-starts.
 * Extracted from Feature 15's `conversational-setup.tsx` (its own FR-253)
 * so Feature 16's AI Prompt Search voice entry can reuse the exact same
 * `MediaRecorder`/`getUserMedia` logic instead of a second copy
 * (`docs/requirements.md` Feature 16 Open Items #4).
 *
 * Feature 22 FR-318: `isProcessing` is owned entirely by the caller (each
 * call site's own transcription mutation's `isPending`) — this hook never
 * reaches into a caller's own React Query mutation, only combines that one
 * externally-owned boolean with its own real recorder state to derive
 * `status`. FR-319: `hintVisible` tracks the short-lived guidance-hint
 * window — visible the instant recording starts, hidden after
 * `HINT_VISIBLE_MS` or immediately on stop, whichever is sooner.
 */
export function useVoiceRecording(
  onDone: (blob: Blob) => void,
  isProcessing = false,
) {
  const [isRecording, setIsRecording] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHintTimer() {
    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
  }

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      onDone(new Blob(chunksRef.current, { type: "audio/webm" }));
    };
    recorder.start();
    recorderRef.current = recorder;
    setIsRecording(true);
    setHintVisible(true);
    clearHintTimer();
    hintTimerRef.current = setTimeout(() => setHintVisible(false), HINT_VISIBLE_MS);
  }

  function stop() {
    recorderRef.current?.stop();
    setIsRecording(false);
    setHintVisible(false);
    clearHintTimer();
  }

  // Never leaves a pending timer running past unmount.
  useEffect(() => clearHintTimer, []);

  const status: VoiceRecordingStatus = isRecording
    ? "recording"
    : isProcessing
      ? "processing"
      : "idle";

  return {
    status,
    isRecording,
    hintVisible,
    toggle: () => (isRecording ? stop() : void start()),
  };
}
