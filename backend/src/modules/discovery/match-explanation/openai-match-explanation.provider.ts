import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GeneratedExplanation,
  GroundingCheckResult,
  MatchExplanationFacts,
  MatchExplanationProviderInterface,
} from './match-explanation-provider.interface';
import { AiUsageTrackerService } from '../../../common/ai/ai-usage-tracker.service';
import { hasTextualSupport } from './grounding-entity-check';

const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

// Feature 21 (FR-302): structured positive/negative explanation — arrays of
// short phrases, not a single sentence. `mismatches` may legitimately
// be empty (FR-304).
const GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    reasons: { type: 'array', items: { type: 'string' } },
    mismatches: { type: 'array', items: { type: 'string' } },
  },
  required: ['reasons', 'mismatches'],
  additionalProperties: false,
} as const;

const GROUNDING_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    grounded: { type: 'boolean' },
    unsupportedClaim: { type: ['string', 'null'] },
  },
  required: ['grounded', 'unsupportedClaim'],
  additionalProperties: false,
} as const;

// The second, complementary check (grounding-entity-check.ts's own file
// comment has the full real-finding rationale). Deliberately a much
// narrower, more mechanical extraction task than the grounding judgment
// itself — "what specific things does this sentence name," not "is this
// claim reasonable" — every claim gets its own entry so a genuinely generic
// claim ("you might get along well") can correctly report an empty array.
const ENTITY_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          entities: { type: 'array', items: { type: 'string' } },
        },
        required: ['claim', 'entities'],
        additionalProperties: false,
      },
    },
  },
  required: ['claims'],
  additionalProperties: false,
} as const;

const ENTITY_EXTRACTION_SYSTEM_PROMPT = `For each claim below, list every specific, nameable fact it asserts — a place name, a named
event, a relationship or family detail, a physical description, a habit, a skill, a profession
detail, or anything else concrete and specific. Do NOT list generic/vague phrasing (e.g. "you two
would get along well" has zero entities) or things already given directly as age/city/dating
intent. One short entry per distinct fact named — the exact word or short phrase from the claim
itself, not a paraphrase of it. A claim naming nothing specific gets an empty array.`;

/** FR-119/FR-120: only the facts either user actually set, nothing invented. */
function renderFacts(label: string, facts: MatchExplanationFacts): string {
  const lines: string[] = [];
  if (facts.displayName) lines.push(`name: ${facts.displayName}`);
  if (facts.age !== null) lines.push(`age: ${facts.age}`);
  if (facts.city) lines.push(`city: ${facts.city}`);
  if (facts.bio) lines.push(`bio: ${facts.bio}`);
  if (facts.interests.length > 0)
    lines.push(`interests: ${facts.interests.join(', ')}`);
  if (facts.datingIntent) lines.push(`looking for: ${facts.datingIntent}`);
  return lines.length > 0
    ? `${label}:\n${lines.join('\n')}`
    : `${label}: (no profile fields set)`;
}

const GENERATE_SYSTEM_PROMPT = `You write a short "why you two might click" explanation for a dating app, in English,
based ONLY on the two real profiles given below.

Produce TWO lists:
- "reasons": 1-3 short phrases naming real, positive points of alignment between the two people —
  reference only facts explicitly listed for at least one of them. Never invent a shared interest,
  city, personality trait, or anything else not literally present in the given facts.
- "mismatches": 0-2 short phrases naming real, honest potential points of friction or difference
  between the two people, grounded the same way — e.g. a stated relationship-goal difference, or a
  difference implied by their stated cities/interests. An empty array is a completely normal,
  correct result for a strongly-aligned pair — never invent a mismatch just to fill the list.

If very little is given for either person, keep both lists short and honest rather than inventing
detail to fill them.`;

const GROUNDING_CHECK_SYSTEM_PROMPT = `You are a fact-checker for a dating-app match explanation's "reasons" and "mismatches" lists,
given two real profile fact sheets. Check EVERY claim in BOTH lists — a fabricated mismatch is
exactly as much a problem as a fabricated reason. Your job is to catch FABRICATION, not to demand
verbatim word matching.

A claim is GROUNDED if it is a reasonable paraphrase, synonym, gloss, or summary of something
actually in the fact sheets — e.g. if a bio says "hiking" and another says "nature walks",
calling this "shared love of nature" or "the outdoors" is GROUNDED, not a fabrication, because
it's the same real thing described two ways. Likewise combining "books" and "novel-reading" into
"both enjoy reading" is GROUNDED. Age, city, dating-intent facts stated directly are GROUNDED. A
generic non-specific statement (e.g. "you might get along well") is always GROUNDED.

A claim is NOT grounded only when it introduces information that has NO reasonable basis in
either fact sheet at all — a specific interest, place, personality trait, shared history,
physical description, or life event that isn't a paraphrase of anything actually listed. If in
doubt between "reasonable paraphrase" and "invented," prefer GROUNDED — this check exists to
catch real hallucination (a fabricated hometown, an invented hobby, a made-up shared experience),
not to penalize normal natural-language phrasing of the same real facts.

Return the single unsupported claim if any, otherwise null.`;
// A real, measured finding (docs/roadmap.md "Watch items"), not left
// implicit: a first attempt at improving this prompt added 8 few-shot
// "NOT-grounded" examples (drawn from a real fabrication probe) directly
// above this line — a real, isolated A/B test showed that made the catch
// rate *worse* (2/8 vs. a 5/8 baseline with no prompt change at all), not
// better, so it was reverted rather than kept on the strength of intuition
// alone. temperature is still pinned to 0 below — isolated on its own, that
// alone was neutral on the catch rate (5/8, same as baseline) but removed a
// real, separately-confirmed source of non-determinism (the exact same
// input previously returned different verdicts run to run).

/**
 * FR-118/FR-119: real OpenAI calls (`gpt-4o-mini`, matching Feature 9's
 * extraction model — no new vendor decision) for both generating and
 * independently verifying a match explanation. Fails CLOSED, matching every
 * other real provider in this codebase — `MatchExplanationService` is
 * responsible for this feature's fail-open posture (FR-121), not this class.
 */
@Injectable()
export class OpenAiMatchExplanationProvider implements MatchExplanationProviderInterface {
  constructor(
    private readonly config: ConfigService,
    private readonly usageTracker: AiUsageTrackerService,
  ) {}

  async generate(
    userA: MatchExplanationFacts,
    userB: MatchExplanationFacts,
  ): Promise<GeneratedExplanation> {
    const content = await this.chat(
      [
        { role: 'system', content: GENERATE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${renderFacts('Person A', userA)}\n\n${renderFacts('Person B', userB)}`,
        },
      ],
      'match-explanation-generate',
      {
        type: 'json_schema',
        json_schema: {
          name: 'match_explanation',
          strict: true,
          schema: GENERATE_SCHEMA,
        },
      },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ServiceUnavailableException(
        'Match explanation service returned malformed JSON.',
      );
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new ServiceUnavailableException(
        'Match explanation service returned an unexpected shape.',
      );
    }
    const v = parsed as { reasons?: unknown; mismatches?: unknown };
    return {
      reasons: Array.isArray(v.reasons)
        ? v.reasons.filter((x): x is string => typeof x === 'string')
        : [],
      mismatches: Array.isArray(v.mismatches)
        ? v.mismatches.filter((x): x is string => typeof x === 'string')
        : [],
    };
  }

  async checkGrounded(
    userA: MatchExplanationFacts,
    userB: MatchExplanationFacts,
    explanation: GeneratedExplanation,
  ): Promise<GroundingCheckResult> {
    const claimsText = [
      ...explanation.reasons.map((r) => `[reason] ${r}`),
      ...explanation.mismatches.map((m) => `[mismatch] ${m}`),
    ].join('\n');

    const content = await this.chat(
      [
        { role: 'system', content: GROUNDING_CHECK_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${renderFacts('Person A', userA)}\n\n${renderFacts('Person B', userB)}\n\nClaims to check:\n${claimsText || '(none)'}`,
        },
      ],
      'match-explanation-grounding-check',
      {
        type: 'json_schema',
        json_schema: {
          name: 'grounding_check',
          strict: true,
          schema: GROUNDING_CHECK_SCHEMA,
        },
      },
      // A real, quantified finding (docs/roadmap.md "Watch items"): with no
      // temperature set (defaulting to OpenAI's own 1.0), a direct 18-call
      // probe against this exact prompt found ~56% of clearly-fabricated
      // claims missed — genuine sampling variance on a fact-check task that
      // should behave the same way on the same input every time. Pinning to
      // 0 did NOT raise the catch rate on its own (an isolated re-probe of
      // the same 8 fabrications measured 5/8 both before and after — same
      // as this exact prompt's own baseline), but it did make the result
      // genuinely reproducible instead of a coin flip on identical input,
      // which is worth having on its own. `generate()` above deliberately
      // keeps its own default temperature — some phrasing variety is
      // desirable there, and it isn't the call being fact-checked.
      0,
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ServiceUnavailableException(
        'Grounding check service returned malformed JSON.',
      );
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { grounded?: unknown }).grounded !== 'boolean'
    ) {
      throw new ServiceUnavailableException(
        'Grounding check service returned an unexpected shape.',
      );
    }
    const result = parsed as { grounded: boolean; unsupportedClaim?: unknown };
    const llmVerdict: GroundingCheckResult = {
      grounded: result.grounded,
      unsupportedClaim:
        typeof result.unsupportedClaim === 'string'
          ? result.unsupportedClaim
          : null,
    };

    // The second, complementary check (grounding-entity-check.ts) — only
    // ever runs when the LLM-judge already says GROUNDED, and can only
    // narrow that verdict further, never loosen a real rejection: a
    // deterministic veto specifically for the false-negative class the
    // LLM-judge alone was measured missing roughly half the time (a
    // wholesale-invented, specific fact with zero textual basis anywhere in
    // either profile), not a second vote on genuine paraphrase judgment
    // calls, which stay the LLM-judge's own job entirely.
    if (
      llmVerdict.grounded &&
      (explanation.reasons.length > 0 || explanation.mismatches.length > 0)
    ) {
      const veto = await this.findEntityVeto(userA, userB, explanation);
      if (veto) return veto;
    }
    return llmVerdict;
  }

  private async findEntityVeto(
    userA: MatchExplanationFacts,
    userB: MatchExplanationFacts,
    explanation: GeneratedExplanation,
  ): Promise<GroundingCheckResult | null> {
    const claims = [...explanation.reasons, ...explanation.mismatches];
    const content = await this.chat(
      [
        { role: 'system', content: ENTITY_EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Claims:\n${claims.map((c) => `- ${c}`).join('\n')}`,
        },
      ],
      'match-explanation-grounding-check',
      {
        type: 'json_schema',
        json_schema: {
          name: 'entity_extraction',
          strict: true,
          schema: ENTITY_EXTRACTION_SCHEMA,
        },
      },
      0,
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Fail open on THIS check specifically — it's a defensive add-on, not
      // the primary grounding gate, so a malformed extraction response
      // should never itself turn into a 503 for the whole feature.
      return null;
    }
    const rows = (parsed as { claims?: unknown }).claims;
    if (!Array.isArray(rows)) return null;

    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const { claim, entities } = row as {
        claim?: unknown;
        entities?: unknown;
      };
      if (typeof claim !== 'string' || !Array.isArray(entities)) continue;
      const entityStrings = entities.filter(
        (e): e is string => typeof e === 'string',
      );
      if (!hasTextualSupport(entityStrings, userA, userB)) {
        return { grounded: false, unsupportedClaim: claim };
      }
    }
    return null;
  }

  /**
   * FR-298 (Feature 21): the one fetch chokepoint in this file, so usage
   * tracking lives here once rather than duplicated in both `generate()`
   * and `checkGrounded()` — `feature` distinguishes the two in AiUsageEvent
   * rows (`match-explanation-generate` / `match-explanation-grounding-check`).
   */
  private async chat(
    messages: { role: string; content: string }[],
    feature: 'match-explanation-generate' | 'match-explanation-grounding-check',
    responseFormat?: Record<string, unknown>,
    temperature?: number,
  ): Promise<string> {
    const apiKey = this.config.getOrThrow<string>('OPENAI_API_KEY');
    const timeoutMs = this.config.getOrThrow<number>(
      'MATCH_EXPLANATION_TIMEOUT_MS',
    );
    const startedAt = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs).unref();

      let response: Response;
      try {
        response = await fetch(CHAT_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: MODEL,
            messages,
            ...(responseFormat ? { response_format: responseFormat } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
          }),
          signal: controller.signal,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ServiceUnavailableException(
          `Could not reach the match explanation service: ${message}`,
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Match explanation service returned ${response.status}.`,
        );
      }

      let body: {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        body = (await response.json()) as typeof body;
      } catch {
        throw new ServiceUnavailableException(
          'Match explanation service returned an unparseable response.',
        );
      }

      const content = body.choices?.[0]?.message?.content;
      if (!content) {
        throw new ServiceUnavailableException(
          'Match explanation service returned no result.',
        );
      }

      void this.usageTracker.record({
        provider: 'openai',
        model: MODEL,
        feature,
        success: true,
        latencyMs: Date.now() - startedAt,
        promptTokens: body.usage?.prompt_tokens,
        completionTokens: body.usage?.completion_tokens,
      });
      return content;
    } catch (err) {
      void this.usageTracker.record({
        provider: 'openai',
        model: MODEL,
        feature,
        success: false,
        latencyMs: Date.now() - startedAt,
      });
      throw err;
    }
  }
}
