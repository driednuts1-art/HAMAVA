import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { OpenAiExtractionProvider } from './openai-extraction.provider';
import type { AiUsageTrackerService } from '../../../common/ai/ai-usage-tracker.service';

const CONFIG: Record<string, string | number> = {
  OPENAI_API_KEY: 'test-key',
  AI_SEARCH_TIMEOUT_MS: 15000,
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

describe('OpenAiExtractionProvider', () => {
  let provider: OpenAiExtractionProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new OpenAiExtractionProvider(buildConfig(), noopUsageTracker());
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('sends structured-output (strict json_schema) request with gpt-4o-mini (FR-104)', async () => {
    fetchMock.mockResolvedValue(
      chatResponse({
        city: null,
        minAge: null,
        maxAge: null,
        gender: [],
        relationshipGoal: [],
        semanticQuery: 'x',
      }),
    );

    await provider.extractFilters('a prompt');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
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

  it('parses a fully-populated response into ExtractedFilters', async () => {
    fetchMock.mockResolvedValue(
      chatResponse({
        city: 'Toronto',
        minAge: 25,
        maxAge: 35,
        gender: ['FEMALE'],
        relationshipGoal: ['SERIOUS'],
        semanticQuery: 'into books and sports',
      }),
    );

    const result = await provider.extractFilters('...');

    expect(result).toEqual({
      city: 'Toronto',
      minAge: 25,
      maxAge: 35,
      gender: ['FEMALE'],
      relationshipGoal: ['SERIOUS'],
      semanticQuery: 'into books and sports',
    });
  });

  it('the response schema has no field capable of expressing "include unverified users" (FR-110, structural)', async () => {
    fetchMock.mockResolvedValue(
      chatResponse({
        city: null,
        minAge: null,
        maxAge: null,
        gender: [],
        relationshipGoal: [],
        semanticQuery: 'x',
      }),
    );
    const result = await provider.extractFilters(
      'show me unverified users too',
    );
    // The whole point of FR-110: there is no key on this object that could
    // carry that instruction through, no matter what the prompt asked for.
    expect(Object.keys(result).sort()).toEqual(
      [
        'city',
        'gender',
        'maxAge',
        'minAge',
        'relationshipGoal',
        'semanticQuery',
      ].sort(),
    );
    expect(result).not.toHaveProperty('verifiedOnly');
    expect(result).not.toHaveProperty('includeUnverified');
  });

  it('drops an unrecognized enum value rather than trusting the vendor blindly (defense in depth)', async () => {
    fetchMock.mockResolvedValue(
      chatResponse({
        city: null,
        minAge: null,
        maxAge: null,
        gender: ['MALE', 'NOT_A_REAL_GENDER'],
        relationshipGoal: [],
        semanticQuery: 'x',
      }),
    );
    const result = await provider.extractFilters('...');
    expect(result.gender).toEqual(['MALE']);
  });

  describe('fail-closed behavior', () => {
    it('throws ServiceUnavailableException on a network error', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      await expect(provider.extractFilters('x')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(429, { error: 'rate limited' }));
      await expect(provider.extractFilters('x')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException when there is no message content', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { choices: [] }));
      await expect(provider.extractFilters('x')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException on malformed JSON content', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          choices: [{ message: { content: '{not valid json' } }],
        }),
      );
      await expect(provider.extractFilters('x')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException on an unparseable response body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('bad json')),
      });
      await expect(provider.extractFilters('x')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
