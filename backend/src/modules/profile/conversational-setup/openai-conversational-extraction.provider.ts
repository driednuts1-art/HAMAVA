import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationalExtractionProviderInterface } from './conversational-extraction-provider.interface';
import {
  CONVERSATIONAL_FIELDS,
  ConversationalField,
  ConversationalTurn,
  ExtractedTurnField,
  TurnExtractionResult,
} from './types';
import { AiUsageTrackerService } from '../../../common/ai/ai-usage-tracker.service';

const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

// FR-138: OpenAI Structured Outputs (strict json_schema) — the model is
// CONSTRAINED to this shape, not just instructed to produce it. "field" can
// only ever be one of the five known Feature 2 field names or null; there
// is no way for this schema to name gender/datingIntent or anything else.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    field: {
      type: ['string', 'null'],
      enum: [...CONVERSATIONAL_FIELDS, null],
    },
    stringValue: { type: ['string', 'null'] },
    interestsValue: {
      type: ['array', 'null'],
      items: { type: 'string' },
    },
    birthDateGregorian: { type: ['string', 'null'] },
    birthDateDisplay: { type: ['string', 'null'] },
    confidence: { type: ['number', 'null'] },
    assistantReply: { type: 'string' },
  },
  required: [
    'field',
    'stringValue',
    'interestsValue',
    'birthDateGregorian',
    'birthDateDisplay',
    'confidence',
    'assistantReply',
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You guide a short, warm, natural-language conversation that fills in a dating-app
profile one field at a time. You are given the conversation so far, the list of fields still
needed, and the user's latest message. The user may write in any language — ALWAYS reply in the
SAME language as their latest message (detect it fresh each turn; never default to a fixed
language regardless of what they actually used).

From the user's LATEST message only, identify AT MOST ONE target field and propose a candidate
value for it. Never invent a value that isn't actually stated or clearly implied by what the user
just said — if their message doesn't clearly answer one of the still-needed fields, set "field" to
null and just ask again or move on. The five possible fields, and how to fill each one:
- "displayName": the name they want shown on their profile — set "stringValue".
- "city": the city they actually live in — set "stringValue".
- "bio": a short self-description — set "stringValue" to a natural short bio drawn from what they
  said, not a verbatim copy of their whole message.
- "interests": specific hobbies/interests they mention — set "interestsValue" (an array).
- "birthDate": the hardest one. A user may state their birth year/date in the Gregorian calendar,
  the Persian (Jalali/Shamsi) calendar, or an age. Resolve it to a Gregorian
  "YYYY-MM-DD" in "birthDateGregorian", AND ALWAYS set "birthDateDisplay" to a string naming BOTH
  the calendar you interpreted the answer as AND the resulting Gregorian date explicitly, e.g.
  "Persian calendar 1370/5/12 → Gregorian 1991-07-30" (illustrating the structure only — write the
  calendar names and wording in the SAME language as your reply, not necessarily English) — never
  just the bare Gregorian date alone, so a wrong calendar assumption is visible and catchable, not
  hidden inside a number. If you cannot resolve a specific day/month, use a reasonable placeholder
  day (e.g. the 1st) and say so plainly in "birthDateDisplay" (e.g. "Persian calendar 1370
  (day/month unknown) → Gregorian 1991-01-01 (approximate)").
When "field" is anything other than "birthDate", leave both birthDate outputs null. When "field"
is not "interests", leave "interestsValue" null. When "field" is not one of
displayName/city/bio, leave "stringValue" null.

ALSO set "confidence": a number from 0 to 1 for how confident you are that the proposed value is
correct, based ONLY on how clearly and unambiguously the user's own latest message states it (not
how plausible the value sounds in general). A direct, explicit statement ("My name is Sarah") should
be high (0.9+); something inferred or only loosely implied should be lower. Set "confidence" to
null whenever "field" itself is null.

ALWAYS also set "assistantReply": a short, natural next message in the SAME language as the user's
latest message — if you just proposed a value, briefly acknowledge it and then ask about ONE of
the still-needed fields (never more than one at a time); if nothing was extracted this turn,
gently ask again or move to a still-needed field. Never ask about a field that isn't in the "still
needed" list you're given. You have no
ability to save anything yourself — you only ever propose; a human always confirms separately.`;

interface OpenAiChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * FR-138/FR-139: real extraction + next-question generation via OpenAI
 * structured outputs. Fails CLOSED like every other real vendor call in
 * this codebase.
 */
@Injectable()
export class OpenAiConversationalExtractionProvider implements ConversationalExtractionProviderInterface {
  constructor(
    private readonly config: ConfigService,
    private readonly usageTracker: AiUsageTrackerService,
  ) {}

  async extractTurn(
    recentTurns: ConversationalTurn[],
    remainingFields: ConversationalField[],
    latestUserMessage: string,
  ): Promise<TurnExtractionResult> {
    const apiKey = this.config.getOrThrow<string>('OPENAI_API_KEY');
    const timeoutMs = this.config.getOrThrow<number>(
      'CONVERSATIONAL_SETUP_TIMEOUT_MS',
    );
    const startedAt = Date.now();

    try {
      return await this.doExtractTurn(
        recentTurns,
        remainingFields,
        latestUserMessage,
        apiKey,
        timeoutMs,
        startedAt,
      );
    } catch (err) {
      void this.usageTracker.record({
        provider: 'openai',
        model: MODEL,
        feature: 'conversational-extraction',
        success: false,
        latencyMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  private async doExtractTurn(
    recentTurns: ConversationalTurn[],
    remainingFields: ConversationalField[],
    latestUserMessage: string,
    apiKey: string,
    timeoutMs: number,
    startedAt: number,
  ): Promise<TurnExtractionResult> {
    const contextMessage = `Fields still needed: ${JSON.stringify(remainingFields)}\n\nConversation so far:\n${recentTurns
      .map((t) => `${t.role}: ${t.content}`)
      .join('\n')}\n\nUser's latest message: ${latestUserMessage}`;

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
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: contextMessage },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'conversational_turn_extraction',
              strict: true,
              schema: RESPONSE_SCHEMA,
            },
          },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(
        `Could not reach the conversational-setup extraction service: ${message}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Conversational-setup extraction service returned ${response.status}.`,
      );
    }

    let body: OpenAiChatResponse;
    try {
      body = (await response.json()) as OpenAiChatResponse;
    } catch {
      throw new ServiceUnavailableException(
        'Conversational-setup extraction service returned an unparseable response.',
      );
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new ServiceUnavailableException(
        'Conversational-setup extraction service returned no result.',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ServiceUnavailableException(
        'Conversational-setup extraction service returned malformed JSON.',
      );
    }

    const result = this.validate(parsed);
    void this.usageTracker.record({
      provider: 'openai',
      model: MODEL,
      feature: 'conversational-extraction',
      success: true,
      latencyMs: Date.now() - startedAt,
      promptTokens: body.usage?.prompt_tokens,
      completionTokens: body.usage?.completion_tokens,
    });
    return result;
  }

  /** Defense in depth: never trust the vendor's own strict-mode guarantee blindly. */
  private validate(value: unknown): TurnExtractionResult {
    if (typeof value !== 'object' || value === null) {
      throw new ServiceUnavailableException(
        'Conversational-setup extraction service returned an unexpected shape.',
      );
    }
    const v = value as Record<string, unknown>;

    const field: ConversationalField | null = (
      CONVERSATIONAL_FIELDS as readonly string[]
    ).includes(v.field as string)
      ? (v.field as ConversationalField)
      : null;

    const proposed: ExtractedTurnField = {
      field,
      stringValue: typeof v.stringValue === 'string' ? v.stringValue : null,
      interestsValue: Array.isArray(v.interestsValue)
        ? v.interestsValue.filter((x): x is string => typeof x === 'string')
        : null,
      birthDateGregorian:
        typeof v.birthDateGregorian === 'string' ? v.birthDateGregorian : null,
      birthDateDisplay:
        typeof v.birthDateDisplay === 'string' ? v.birthDateDisplay : null,
      confidence:
        typeof v.confidence === 'number' &&
        v.confidence >= 0 &&
        v.confidence <= 1
          ? v.confidence
          : null,
    };

    return {
      proposed,
      assistantReply:
        typeof v.assistantReply === 'string' && v.assistantReply.length > 0
          ? v.assistantReply
          : 'Thanks! Can you tell me more?',
    };
  }
}
