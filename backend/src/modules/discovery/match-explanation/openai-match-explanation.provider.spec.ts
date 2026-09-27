import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { OpenAiMatchExplanationProvider } from './openai-match-explanation.provider';
import type {
  GeneratedExplanation,
  MatchExplanationFacts,
} from './match-explanation-provider.interface';
import type { AiUsageTrackerService } from '../../../common/ai/ai-usage-tracker.service';

function noopUsageTracker(): AiUsageTrackerService {
  return {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AiUsageTrackerService;
}

const CONFIG: Record<string, string | number> = {
  OPENAI_API_KEY: 'test-key',
  MATCH_EXPLANATION_TIMEOUT_MS: 15000,
};

function buildConfig(): ConfigService {
  return {
    getOrThrow: (key: string) => CONFIG[key],
  } as unknown as ConfigService;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function chatResponse(content: string): Response {
  return jsonResponse(200, { choices: [{ message: { content } }] });
}

const PERSON_A: MatchExplanationFacts = {
  displayName: 'Sara',
  age: 27,
  city: 'Tehran',
  bio: 'I love hiking',
  interests: ['hiking'],
  datingIntent: 'SERIOUS',
};
const SPARSE_PERSON: MatchExplanationFacts = {
  displayName: 'Reza',
  age: null,
  city: 'Shiraz',
  bio: null,
  interests: [],
  datingIntent: null,
};

const SOME_EXPLANATION: GeneratedExplanation = {
  reasons: ['Both love hiking.'],
  mismatches: [],
};

describe('OpenAiMatchExplanationProvider (extended by Feature 21 FR-302..FR-304)', () => {
  let provider: OpenAiMatchExplanationProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new OpenAiMatchExplanationProvider(
      buildConfig(),
      noopUsageTracker(),
    );
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  describe('generate', () => {
    it('sends gpt-4o-mini with both fact sheets, using strict json_schema structured output (FR-302)', async () => {
      fetchMock.mockResolvedValue(
        chatResponse(
          JSON.stringify({
            reasons: ['You both love hiking.'],
            mismatches: [],
          }),
        ),
      );

      const result = await provider.generate(PERSON_A, PERSON_A);

      expect(result).toEqual({
        reasons: ['You both love hiking.'],
        mismatches: [],
      });
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as {
        model: string;
        response_format?: { type: string; json_schema: { strict: boolean } };
      };
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.response_format?.type).toBe('json_schema');
      expect(body.response_format?.json_schema.strict).toBe(true);
    });

    it('parses a real, honest empty mismatches array without treating it as an error (FR-304)', async () => {
      fetchMock.mockResolvedValue(
        chatResponse(
          JSON.stringify({
            reasons: ['Both serious about relationships.'],
            mismatches: [],
          }),
        ),
      );

      const result = await provider.generate(PERSON_A, PERSON_A);

      expect(result.mismatches).toEqual([]);
    });

    it('parses a non-empty mismatches array', async () => {
      fetchMock.mockResolvedValue(
        chatResponse(
          JSON.stringify({
            reasons: ['Both love hiking.'],
            mismatches: ['Different relationship-goal timelines.'],
          }),
        ),
      );

      const result = await provider.generate(PERSON_A, PERSON_A);

      expect(result.mismatches).toEqual([
        'Different relationship-goal timelines.',
      ]);
    });

    it('omits unset fields for a sparse profile rather than inventing them', async () => {
      fetchMock.mockResolvedValue(
        chatResponse(
          JSON.stringify({
            reasons: ['A short generic note.'],
            mismatches: [],
          }),
        ),
      );

      await provider.generate(PERSON_A, SPARSE_PERSON);

      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as { messages: { role: string; content: string }[] };
      const userMessage = body.messages.find((m) => m.role === 'user')!.content;
      const [personABlock, personBBlock] = userMessage.split('\n\n');
      expect(personABlock).toMatch(/bio:/); // Sara's real bio is still there
      expect(personBBlock).toContain('Reza');
      expect(personBBlock).not.toMatch(/bio:/); // no bio line for the sparse person
      expect(personBBlock).not.toMatch(/interests:/);
    });

    it('throws ServiceUnavailableException on a network error', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      await expect(provider.generate(PERSON_A, PERSON_A)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(429, {}));
      await expect(provider.generate(PERSON_A, PERSON_A)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException on malformed JSON content', async () => {
      fetchMock.mockResolvedValue(chatResponse('{not valid json'));
      await expect(provider.generate(PERSON_A, PERSON_A)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('checkGrounded', () => {
    it('sends strict json_schema structured output, rendering BOTH reasons and mismatches as claims (FR-302)', async () => {
      fetchMock.mockResolvedValue(
        chatResponse(
          JSON.stringify({ grounded: true, unsupportedClaim: null }),
        ),
      );

      await provider.checkGrounded(PERSON_A, PERSON_A, {
        reasons: ['reason-claim'],
        mismatches: ['mismatch-claim'],
      });

      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as {
        response_format: { type: string; json_schema: { strict: boolean } };
        messages: { role: string; content: string }[];
      };
      expect(body.response_format.type).toBe('json_schema');
      expect(body.response_format.json_schema.strict).toBe(true);
      const userMessage = body.messages.find((m) => m.role === 'user')!.content;
      expect(userMessage).toContain('[reason] reason-claim');
      expect(userMessage).toContain('[mismatch] mismatch-claim');
    });

    it('parses a grounded:true result', async () => {
      fetchMock.mockResolvedValue(
        chatResponse(
          JSON.stringify({ grounded: true, unsupportedClaim: null }),
        ),
      );
      const result = await provider.checkGrounded(
        PERSON_A,
        PERSON_A,
        SOME_EXPLANATION,
      );
      expect(result).toEqual({ grounded: true, unsupportedClaim: null });
    });

    it('parses a grounded:false result with the unsupported claim', async () => {
      fetchMock.mockResolvedValue(
        chatResponse(
          JSON.stringify({ grounded: false, unsupportedClaim: 'scuba diving' }),
        ),
      );
      const result = await provider.checkGrounded(
        PERSON_A,
        PERSON_A,
        SOME_EXPLANATION,
      );
      expect(result).toEqual({
        grounded: false,
        unsupportedClaim: 'scuba diving',
      });
    });

    it('throws ServiceUnavailableException on malformed JSON content', async () => {
      fetchMock.mockResolvedValue(chatResponse('{not valid json'));
      await expect(
        provider.checkGrounded(PERSON_A, PERSON_A, SOME_EXPLANATION),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException on an unexpected shape (missing grounded field)', async () => {
      fetchMock.mockResolvedValue(chatResponse(JSON.stringify({ foo: 'bar' })));
      await expect(
        provider.checkGrounded(PERSON_A, PERSON_A, SOME_EXPLANATION),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException on a network error', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      await expect(
        provider.checkGrounded(PERSON_A, PERSON_A, SOME_EXPLANATION),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
