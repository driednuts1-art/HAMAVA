export const TRANSCRIPTION_PROVIDER = Symbol('TRANSCRIPTION_PROVIDER');

/**
 * FR-105 (Feature 9): speech-to-text, forced to Persian (not auto-detected).
 * Shared by AI Prompt Search's voice entry point and Feature 11's
 * conversational voice turns (FR-137) — one implementation, not two OpenAI
 * clients. The caller is responsible for never persisting the audio bytes
 * (FR-106/FR-145) — this interface only ever returns text, never anything
 * reversible back to audio.
 */
export interface TranscriptionProviderInterface {
  transcribe(
    audio: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<string>;
}
