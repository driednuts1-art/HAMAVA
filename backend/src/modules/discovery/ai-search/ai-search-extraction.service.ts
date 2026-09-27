import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  AI_SEARCH_EXTRACTION_PROVIDER,
  ExtractedFilters,
} from './extraction-provider.interface';
import type { AiSearchExtractionProviderInterface } from './extraction-provider.interface';
import { TRANSCRIPTION_PROVIDER } from '../../../common/ai/transcription-provider.interface';
import type { TranscriptionProviderInterface } from '../../../common/ai/transcription-provider.interface';
import { AiSearchRateLimitService } from './ai-search-rate-limit.service';
import { withDeckFallbackHint } from './vendor-failure.util';

// FR-107: confirmed against OpenAI's real, current API reference at
// implementation time (Open Items #5) — Whisper accepts exactly these
// extensions. Checked by extension, not multipart mimetype, since Whisper
// itself infers format from the filename it's given, and mimetype strings
// for audio vary inconsistently by client/browser.
const ALLOWED_AUDIO_EXTENSIONS = [
  'mp3',
  'mp4',
  'mpeg',
  'mpga',
  'm4a',
  'wav',
  'webm',
];

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Orchestrates FR-103..FR-108: rate limiting (FR-115) plus the real vendor
 * calls, kept separate from `AiSearchService` (the ranking/retrieval half,
 * FR-109..FR-114) since these are independent pipeline stages with nothing
 * in common beyond both being real, billed OpenAI calls.
 */
@Injectable()
export class AiSearchExtractionService {
  constructor(
    private readonly rateLimit: AiSearchRateLimitService,
    @Inject(AI_SEARCH_EXTRACTION_PROVIDER)
    private readonly extractionProvider: AiSearchExtractionProviderInterface,
    @Inject(TRANSCRIPTION_PROVIDER)
    private readonly transcriptionProvider: TranscriptionProviderInterface,
  ) {}

  /** FR-103/FR-104: text path. */
  async extractFromText(
    userId: string,
    text: string,
  ): Promise<ExtractedFilters> {
    await this.rateLimit.enforce(userId, 'TEXT');
    return withDeckFallbackHint(() =>
      this.extractionProvider.extractFilters(text),
    );
  }

  /**
   * FR-105..FR-108: voice path. FR-106 (never persisting audio) is upheld by
   * construction — this method only ever reads the buffer it's given and
   * returns text; nothing here writes it anywhere, and the caller (the
   * controller) does not either — the buffer is only ever the in-memory
   * Multer buffer for the lifetime of this one request.
   */
  async transcribeAndExtract(
    userId: string,
    audio: Buffer,
    originalFilename: string,
    mimeType: string,
  ): Promise<{ transcribedText: string; filters: ExtractedFilters }> {
    const extension = extensionOf(originalFilename);
    if (!ALLOWED_AUDIO_EXTENSIONS.includes(extension)) {
      // FR-107: rejected before any vendor call — checked before the rate
      // limit is even charged, since this isn't a real search attempt.
      throw new BadRequestException(
        `Unsupported audio format ".${extension}". Allowed: ${ALLOWED_AUDIO_EXTENSIONS.join(', ')}.`,
      );
    }

    await this.rateLimit.enforce(userId, 'VOICE');
    const transcribedText = await withDeckFallbackHint(() =>
      this.transcriptionProvider.transcribe(audio, originalFilename, mimeType),
    );
    // FR-108: the transcript feeds the identical extraction path as typed
    // text — no separate/duplicated logic. Not counted against the rate
    // limit a second time; the VOICE charge above already covers this
    // whole request (extraction is comparatively cheap next to Whisper).
    const filters = await withDeckFallbackHint(() =>
      this.extractionProvider.extractFilters(transcribedText),
    );
    return { transcribedText, filters };
  }
}
