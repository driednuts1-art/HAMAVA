import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingProviderInterface } from './embedding-provider.interface';
import { AiUsageTrackerService } from './ai-usage-tracker.service';

const EMBEDDINGS_ENDPOINT = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-3-small';

interface OpenAiEmbeddingResponse {
  data?: { embedding: number[] }[];
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

/**
 * FR-111/FR-112: real embeddings via OpenAI (`text-embedding-3-small`, 1536
 * dimensions — matches `User.bioEmbedding vector(1536)`). Fails CLOSED,
 * mirroring `OpenAiContentModerationProvider`'s exact pattern — a network
 * error, timeout, non-2xx response, or unparseable body throws
 * `ServiceUnavailableException` (503) rather than silently skipping the
 * embedding or returning a zero vector that would rank meaninglessly.
 */
@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProviderInterface {
  constructor(
    private readonly config: ConfigService,
    private readonly usageTracker: AiUsageTrackerService,
  ) {}

  async embed(text: string): Promise<number[]> {
    const apiKey = this.config.getOrThrow<string>('OPENAI_API_KEY');
    const timeoutMs = this.config.getOrThrow<number>('AI_SEARCH_TIMEOUT_MS');
    const startedAt = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs).unref();

      let response: Response;
      try {
        response = await fetch(EMBEDDINGS_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model: MODEL, input: text }),
          signal: controller.signal,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ServiceUnavailableException(
          `Could not reach the embedding service: ${message}`,
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Embedding service returned ${response.status}.`,
        );
      }

      let body: OpenAiEmbeddingResponse;
      try {
        body = (await response.json()) as OpenAiEmbeddingResponse;
      } catch {
        throw new ServiceUnavailableException(
          'Embedding service returned an unparseable response.',
        );
      }

      const embedding = body.data?.[0]?.embedding;
      if (!embedding || embedding.length === 0) {
        throw new ServiceUnavailableException(
          'Embedding service returned no result.',
        );
      }

      void this.usageTracker.record({
        provider: 'openai',
        model: MODEL,
        feature: 'embedding',
        success: true,
        latencyMs: Date.now() - startedAt,
        promptTokens: body.usage?.prompt_tokens,
      });
      return embedding;
    } catch (err) {
      void this.usageTracker.record({
        provider: 'openai',
        model: MODEL,
        feature: 'embedding',
        success: false,
        latencyMs: Date.now() - startedAt,
      });
      throw err;
    }
  }
}
