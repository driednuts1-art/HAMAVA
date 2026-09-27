import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AiUsageEntry {
  userId?: string;
  provider: string;
  model: string;
  feature: string;
  success: boolean;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

/**
 * Feature 21 (FR-298/FR-299): real per-call cost estimates, checked against
 * OpenAI's published per-model pricing at implementation time (2026-08) —
 * a static table, not a live pricing API (docs/requirements.md Feature 21
 * Open Items #3). Needs a manual update if OpenAI's pricing changes, the
 * same maintenance posture as any other hardcoded reference value in this
 * codebase. Whisper (`whisper-1`) is priced per-minute of audio, not
 * tokens — no token-based estimate applies, so transcription calls simply
 * have no `estimatedCostUsd` (null, not a guessed number). The moderation
 * endpoint (`omni-moderation-latest`) has always been free.
 */
const COST_PER_1K_TOKENS_USD: Record<
  string,
  { prompt: number; completion: number } | undefined
> = {
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'text-embedding-3-small': { prompt: 0.00002, completion: 0 },
  'omni-moderation-latest': { prompt: 0, completion: 0 },
};

function estimateCostUsd(
  model: string,
  promptTokens?: number,
  completionTokens?: number,
): number | undefined {
  const rate = COST_PER_1K_TOKENS_USD[model];
  if (!rate || promptTokens === undefined) return undefined;
  const promptCost = (promptTokens / 1000) * rate.prompt;
  const completionCost = ((completionTokens ?? 0) / 1000) * rate.completion;
  return promptCost + completionCost;
}

/**
 * FR-298/FR-299: one shared sink every real `OpenAi*Provider` records to,
 * after every real call — success or failure, latency always measured.
 * Never logs or stores prompt/completion content (FR-299) — metadata only.
 * Fail-open by design: a usage-tracking write must never affect a real AI
 * call's own result, the same posture `ProfileService.recomputeBioEmbedding()`
 * already established for a different non-critical side effect.
 */
@Injectable()
export class AiUsageTrackerService {
  private readonly logger = new Logger(AiUsageTrackerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AiUsageEntry): Promise<void> {
    try {
      await this.prisma.aiUsageEvent.create({
        data: {
          userId: entry.userId,
          provider: entry.provider,
          model: entry.model,
          feature: entry.feature,
          success: entry.success,
          latencyMs: entry.latencyMs,
          promptTokens: entry.promptTokens,
          completionTokens: entry.completionTokens,
          estimatedCostUsd: estimateCostUsd(
            entry.model,
            entry.promptTokens,
            entry.completionTokens,
          ),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Could not record AI usage event (${entry.provider}/${entry.model}/${entry.feature}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
