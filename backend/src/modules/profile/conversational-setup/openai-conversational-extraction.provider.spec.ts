import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { OpenAiConversationalExtractionProvider } from './openai-conversational-extraction.provider';
import type { AiUsageTrackerService } from '../../../common/ai/ai-usage-tracker.service';

const CONFIG: Record<string, string | number> = {
  OPENAI_API_KEY: 'test-key',
  CONVERSATIONAL_SETUP_TIMEOUT_MS: 15000,
};

function buildConfig(): ConfigService {
  return {
    getOrThrow: (key: string) => CONFIG[key],
  } as unknown as ConfigService;
}

function noopUsageTracker(): AiUsageTrackerService {
  return {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AiUsageTrackerService;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function chatResponse(content: unknown): Response {
  return jsonResponse(200, {
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
}

const EMPTY_FIELD = {
  field: null,
  stringValue: null,
  interestsValue: null,
  birthDateGregorian: null,
  birthDateDisplay: null,
  assistantReply: 'Okay, anything else to add?',
};

describe('OpenAiConversationalExtractionProvider', () => {
  let provider: OpenAiConversationalExtractionProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new OpenAiConversationalExtractionProvider(
      buildConfig(),
      noopUsageTracker(),
    );
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('sends a structured-output (strict json_schema) request with gpt-4o-mini (FR-138)', async () => {
    fetchMock.mockResolvedValue(chatResponse(EMPTY_FIELD));

    await provider.extractTurn([], ['displayName'], 'hi');

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as {
      model: string;
      response_format: { type: string; json_schema: { strict: boolean } };
    };
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it('parses a proposed displayName field', async () => {
    fetchMock.mockResolvedValue(
      chatResponse({
        field: 'displayName',
        stringValue: 'Alex',
        interestsValue: null,
        birthDateGregorian: null,
        birthDateDisplay: null,
        assistantReply: 'What a nice name! Now tell me, where do you live?',
      }),
    );

    const result = await provider.extractTurn(
      [],
      ['displayName', 'city'],
      'My name is Alex',
    );

    expect(result.proposed.field).toBe('displayName');
    expect(result.proposed.stringValue).toBe('Alex');
    expect(result.assistantReply).toContain('live');
  });

  it('parses a real confidence value in [0,1] alongside the proposed field (FR-287)', async () => {
    fetchMock.mockResolvedValue(
      chatResponse({
        field: 'displayName',
        stringValue: 'Alex',
        interestsValue: null,
        birthDateGregorian: null,
        birthDateDisplay: null,
        confidence: 0.95,
        assistantReply: 'Got it!',
      }),
    );

    const result = await provider.extractTurn(
      [],
      ['displayName'],
      'My name is Alex',
    );

    expect(result.proposed.confidence).toBe(0.95);
  });

  it('defaults confidence to null when the field itself is null (nothing proposed)', async () => {
    fetchMock.mockResolvedValue(chatResponse(EMPTY_FIELD));

    const result = await provider.extractTurn([], ['displayName'], 'gibberish');

    expect(result.proposed.field).toBeNull();
    expect(result.proposed.confidence).toBeNull();
  });

  it('defaults confidence to null when the vendor returns an out-of-range or malformed value — defense in depth', async () => {
    fetchMock.mockResolvedValue(
      chatResponse({
        field: 'displayName',
        stringValue: 'Alex',
        interestsValue: null,
        birthDateGregorian: null,
        birthDateDisplay: null,
        confidence: 1.5, // out of the documented [0,1] range
        assistantReply: 'Got it!',
      }),
    );

    const result = await provider.extractTurn(
      [],
      ['displayName'],
      'My name is Alex',
    );

    expect(result.proposed.confidence).toBeNull();
  });

  it('a proposed birthDate always carries both the Gregorian value and the bi-calendar display string (Open Items #1)', async () => {
    fetchMock.mockResolvedValue(
      chatResponse({
        field: 'birthDate',
        stringValue: null,
        interestsValue: null,
        birthDateGregorian: '1991-07-30',
        birthDateDisplay: 'Persian calendar 1370/5/12 → Gregorian 1991-07-30',
        assistantReply: 'Thanks!',
      }),
    );

    const result = await provider.extractTurn(
      [],
      ['birthDate'],
      'I was born on the 12th of Mordad, 1370',
    );

    expect(result.proposed.field).toBe('birthDate');
    expect(result.proposed.birthDateGregorian).toBe('1991-07-30');
    expect(result.proposed.birthDateDisplay).toBe(
      'Persian calendar 1370/5/12 → Gregorian 1991-07-30',
    );
    // Never the bare Gregorian date alone — the calendar assumption itself
    // must be visible so a misparse is human-catchable (FR-142).
    expect(result.proposed.birthDateDisplay).toContain('Persian calendar');
    expect(result.proposed.birthDateDisplay).toContain('Gregorian');
  });

  it('parses a proposed interests field as an array', async () => {
    fetchMock.mockResolvedValue(
      chatResponse({
        field: 'interests',
        stringValue: null,
        interestsValue: ['hiking', 'books'],
        birthDateGregorian: null,
        birthDateDisplay: null,
        assistantReply: 'Great!',
      }),
    );

    const result = await provider.extractTurn(
      [],
      ['interests'],
      'I like hiking and books',
    );

    expect(result.proposed.interestsValue).toEqual(['hiking', 'books']);
  });

  it('drops an unrecognized field name rather than trusting the vendor blindly (defense in depth)', async () => {
    fetchMock.mockResolvedValue(
      chatResponse({
        field: 'gender',
        stringValue: 'MALE',
        interestsValue: null,
        birthDateGregorian: null,
        birthDateDisplay: null,
        assistantReply: 'okay',
      }),
    );

    const result = await provider.extractTurn([], ['displayName'], 'I am male');

    // "gender" is not in CONVERSATIONAL_FIELDS — never trusted through, even
    // if the vendor's strict-mode guarantee should have prevented it.
    expect(result.proposed.field).toBeNull();
  });

  it('proposes nothing when the message does not clearly answer a needed field', async () => {
    fetchMock.mockResolvedValue(chatResponse(EMPTY_FIELD));

    const result = await provider.extractTurn(
      [],
      ['city'],
      'The weather is nice today',
    );

    expect(result.proposed.field).toBeNull();
    expect(result.assistantReply).toBeTruthy();
  });

  describe('fail-closed behavior', () => {
    it('throws ServiceUnavailableException on a network error', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      await expect(
        provider.extractTurn([], ['displayName'], 'x'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(429, { error: 'rate limited' }));
      await expect(
        provider.extractTurn([], ['displayName'], 'x'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException when there is no message content', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { choices: [] }));
      await expect(
        provider.extractTurn([], ['displayName'], 'x'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException on malformed JSON content', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          choices: [{ message: { content: '{not valid json' } }],
        }),
      );
      await expect(
        provider.extractTurn([], ['displayName'], 'x'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException on an unparseable response body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('bad json')),
      });
      await expect(
        provider.extractTurn([], ['displayName'], 'x'),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
