import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranscriptionProviderInterface } from './transcription-provider.interface';
import { AiUsageTrackerService } from './ai-usage-tracker.service';

const TRANSCRIPTIONS_ENDPOINT =
  'https://api.openai.com/v1/audio/transcriptions';
const MODEL = 'whisper-1';
// FR-108: language auto-detected, not forced (explicit user decision,
// 2026-09-24 — "کاربر میتونه با هر زبانی حرف بزنه با هوش مصنوعی": a user may
// speak in any language, so no single fixed ISO-639-1 code is correct for
// every real call). Previously forced 'fa', then briefly 'en' during the
// English/global identity pivot, before this explicit multilingual decision
// superseded both — confirmed via OpenAI's real API reference that omitting
// `language` entirely makes Whisper auto-detect the spoken language instead
// of assuming one.

interface OpenAiTranscriptionResponse {
  text?: string;
}

/**
 * FR-105: real speech-to-text via OpenAI Whisper, with the spoken language
 * auto-detected rather than forced. Fails
 * CLOSED, mirroring every other real vendor call in this codebase — a
 * network error, timeout, non-2xx response, or unparseable body throws
 * `ServiceUnavailableException` (503).
 *
 * The caller (not this provider) is responsible for ever discarding the
 * audio bytes after this call returns (FR-106/FR-145) — this class only
 * ever forwards the buffer it's given, once, and returns text. Shared
 * across features (Feature 9 search, Feature 11 conversational setup) —
 * `AI_TRANSCRIPTION_TIMEOUT_MS` is its own config key, independent of
 * `AI_SEARCH_TIMEOUT_MS` (which now scopes only Feature 9's extraction call).
 */
@Injectable()
export class OpenAiTranscriptionProvider implements TranscriptionProviderInterface {
  constructor(
    private readonly config: ConfigService,
    private readonly usageTracker: AiUsageTrackerService,
  ) {}

  async transcribe(
    audio: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    const apiKey = this.config.getOrThrow<string>('OPENAI_API_KEY');
    const timeoutMs = this.config.getOrThrow<number>(
      'AI_TRANSCRIPTION_TIMEOUT_MS',
    );
    const startedAt = Date.now();

    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([Uint8Array.from(audio)], { type: mimeType }),
        filename,
      );
      form.append('model', MODEL);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs).unref();

      let response: Response;
      try {
        response = await fetch(TRANSCRIPTIONS_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: controller.signal,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ServiceUnavailableException(
          `Could not reach the transcription service: ${message}`,
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Transcription service returned ${response.status}.`,
        );
      }

      let body: OpenAiTranscriptionResponse;
      try {
        body = (await response.json()) as OpenAiTranscriptionResponse;
      } catch {
        throw new ServiceUnavailableException(
          'Transcription service returned an unparseable response.',
        );
      }

      if (typeof body.text !== 'string') {
        throw new ServiceUnavailableException(
          'Transcription service returned no result.',
        );
      }

      // No token-based usage/cost estimate — Whisper is priced per-minute of
      // audio, not tokens (ai-usage-tracker.service.ts's own doc comment).
      void this.usageTracker.record({
        provider: 'openai',
        model: MODEL,
        feature: 'transcription',
        success: true,
        latencyMs: Date.now() - startedAt,
      });
      return body.text;
    } catch (err) {
      void this.usageTracker.record({
        provider: 'openai',
        model: MODEL,
        feature: 'transcription',
        success: false,
        latencyMs: Date.now() - startedAt,
      });
      throw err;
    }
  }
}
