import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { OpenAiContentModerationProvider } from './openai-content-moderation.provider';
import type { AiUsageTrackerService } from '../ai/ai-usage-tracker.service';

const CONFIG: Record<string, string | number> = {
  OPENAI_API_KEY: 'test-key',
  MODERATION_TIMEOUT_MS: 15000,
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

describe('OpenAiContentModerationProvider', () => {
  let provider: OpenAiContentModerationProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new OpenAiContentModerationProvider(
      buildConfig(),
      noopUsageTracker(),
    );
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  function jsonResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response;
  }

  describe('moderateText', () => {
    it('sends the raw string as input with the omni-moderation-latest model', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { results: [{ flagged: false }] }),
      );

      await provider.moderateText('hello');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/moderations',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
        }),
      );
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as { model: string; input: string };
      expect(body).toEqual({ model: 'omni-moderation-latest', input: 'hello' });
    });

    it('resolves approved:true when not flagged', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { results: [{ flagged: false }] }),
      );
      await expect(provider.moderateText('hello')).resolves.toEqual({
        approved: true,
      });
    });

    it('resolves approved:false with a joined category reason when flagged', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          results: [
            {
              flagged: true,
              categories: { harassment: true, violence: true, hate: false },
            },
          ],
        }),
      );
      const result = await provider.moderateText('bad text');
      expect(result.approved).toBe(false);
      expect(result.reason).toBe('harassment, violence');
    });
  });

  describe('moderateImage', () => {
    it('sends a base64 data URI as an image_url content item', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { results: [{ flagged: false }] }),
      );

      await provider.moderateImage(Buffer.from('fake-image-bytes'));

      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as {
        model: string;
        input: { type: string; image_url: { url: string } }[];
      };
      expect(body.model).toBe('omni-moderation-latest');
      expect(body.input).toEqual([
        {
          type: 'image_url',
          image_url: {
            url: `data:image/webp;base64,${Buffer.from('fake-image-bytes').toString('base64')}`,
          },
        },
      ]);
    });
  });

  describe('fail-closed behavior (FR-100)', () => {
    it('throws ServiceUnavailableException on a network error', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      await expect(provider.moderateText('x')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(429, { error: 'rate limited' }));
      await expect(provider.moderateText('x')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException when the response has no results', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { results: [] }));
      await expect(provider.moderateText('x')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException on an unparseable response body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('bad json')),
      });
      await expect(provider.moderateText('x')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
