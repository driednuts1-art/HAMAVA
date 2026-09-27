/**
 * docs/load-testing.md — the global hard cap on real OpenAI-touching calls,
 * per explicit user direction: enforced in the tool's own code, not only
 * documented as a rule a scenario author is trusted to follow. A single
 * shared counter across the *entire* run, not scoped per-tier or per-
 * scenario — even Tier 1's "core" journeys carry real OpenAI cost
 * (MessageService.sendMessage()'s real moderateText() call on every
 * message, Feature 8), so a per-tier cap would give a false sense of
 * safety against exactly the kind of runaway-script bug this exists to
 * catch.
 *
 * Deliberately biased toward over-counting, never under-counting: any
 * scenario code unsure whether a given call reaches OpenAI should call
 * recordOpenAiCall() anyway. A slightly early abort is a minor
 * inconvenience; an uncounted real call defeats the entire point.
 */

export class OpenAiCallLimitExceededError extends Error {
  constructor(limit: number) {
    super(
      `Aborting run: exceeded the hard OpenAI-call cap (${limit}). ` +
        'This is deliberate and immediate — see docs/load-testing.md.',
    );
    this.name = 'OpenAiCallLimitExceededError';
  }
}

let count = 0;
let limit: number | null = null;

/** Must be called once, explicitly, before any scenario runs — there is no
 * silent default limit (docs/load-testing.md's "the run refuses to start
 * without an explicit number"). */
export function initOpenAiCostGuard(maxCalls: number): void {
  if (!Number.isFinite(maxCalls) || maxCalls <= 0) {
    throw new Error(
      `initOpenAiCostGuard() needs a real, positive number — got ${String(maxCalls)}.`,
    );
  }
  limit = maxCalls;
  count = 0;
}

/** Call this for every request that touches an OpenAI-backed endpoint,
 * *before* awaiting the response — the abort must happen before the call
 * fires, not after. `label` is free text for the console log, e.g.
 * "message send (moderation)" or "ai-search extract". */
export function recordOpenAiCall(label: string): void {
  if (limit === null) {
    throw new Error(
      'recordOpenAiCall() was called before initOpenAiCostGuard() — every scenario entry point must initialize the guard first.',
    );
  }
  count += 1;
  if (count % 25 === 0 || count === limit) {
    console.log(
      `[openai-cost-guard] ${count} / ${limit} real OpenAI-touching calls made (last: ${label})`,
    );
  }
  if (count > limit) {
    throw new OpenAiCallLimitExceededError(limit);
  }
}

export function getOpenAiCallCount(): number {
  return count;
}
