import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContentModerationProviderInterface,
  ModerationResult,
} from './content-moderation-provider.interface';
import { AiUsageTrackerService } from '../ai/ai-usage-tracker.service';

const MODERATION_ENDPOINT = 'https://api.openai.com/v1/moderations';
const MODEL = 'omni-moderation-latest';

type ModerationInput =
  string | { type: 'image_url'; image_url: { url: string } }[];

interface OpenAiModerationResponse {
  results?: { flagged: boolean; categories?: Record<string, boolean> }[];
}

/**
 * FR-96: real text + image moderation via OpenAI's Moderation API
 * (omni-moderation-latest, one model for both content types). Fails
 * CLOSED (FR-100), mirroring `ClamAvMalwareScanProvider`'s exact pattern —
 * a network error, timeout, non-2xx response, or unparseable body throws
 * `ServiceUnavailableException` (503) rather than treating unscanned
 * content as approved.
 */
@Injectable()
export class OpenAiContentModerationProvider implements ContentModerationProviderInterface {
  private readonly logger = new Logger(OpenAiContentModerationProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly usageTracker: AiUsageTrackerService,
  ) {}

  moderateText(text: string): Promise<ModerationResult> {
    return this.moderate(text);
  }

  moderateImage(data: Buffer): Promise<ModerationResult> {
    const dataUri = `data:image/webp;base64,${data.toString('base64')}`;
    return this.moderate([{ type: 'image_url', image_url: { url: dataUri } }]);
  }

  private async moderate(input: ModerationInput): Promise<ModerationResult> {
    const apiKey = this.config.getOrThrow<string>('OPENAI_API_KEY');
    const timeoutMs = this.config.getOrThrow<number>('MODERATION_TIMEOUT_MS');
    const startedAt = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs).unref();

      let response: Response;
      try {
        response = await fetch(MODERATION_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model: MODEL, input }),
          signal: controller.signal,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ServiceUnavailableException(
          `Could not reach the moderation service: ${message}`,
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Moderation service returned ${response.status}.`,
        );
      }

      let body: OpenAiModerationResponse;
      try {
        body = (await response.json()) as OpenAiModerationResponse;
      } catch {
        throw new ServiceUnavailableException(
          'Moderation service returned an unparseable response.',
        );
      }

      const result = body.results?.[0];
      if (!result) {
        throw new ServiceUnavailableException(
          'Moderation service returned no result.',
        );
      }

      // The moderation endpoint is free and reports no token usage — success
      // and latency are still real, useful observability signals.
      void this.usageTracker.record({
        provider: 'openai',
        model: MODEL,
        feature: 'moderation',
        success: true,
        latencyMs: Date.now() - startedAt,
      });

      if (!result.flagged) {
        return { approved: true };
      }

      const flaggedCategories = Object.entries(result.categories ?? {})
        .filter(([, isFlagged]) => isFlagged)
        .map(([category]) => category);
      const reason =
        flaggedCategories.length > 0
          ? flaggedCategories.join(', ')
          : 'flagged by moderation';
      this.logger.warn(`Content rejected: ${reason}`);
      return { approved: false, reason };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        void this.usageTracker.record({
          provider: 'openai',
          model: MODEL,
          feature: 'moderation',
          success: false,
          latencyMs: Date.now() - startedAt,
        });
      }
      throw err;
    }
  }
}
