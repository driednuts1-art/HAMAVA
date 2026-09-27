import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { OpenAiTranscriptionProvider } from './openai-transcription.provider';
import type { AiUsageTrackerService } from './ai-usage-tracker.service';

// Feature 21 (FR-298): every real provider now records usage — a no-op mock
// here, since usage tracking is fail-open by design and not what these
// tests are about.
function noopUsageTracker(): AiUsageTrackerService {
  return {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AiUsageTrackerService;
}

const CONFIG: Record<string, string | number> = {
  OPENAI_API_KEY: 'test-key',
  AI_TRANSCRIPTION_TIMEOUT_MS: 15000,
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

describe('OpenAiTranscriptionProvider', () => {
  let provider: OpenAiTranscriptionProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new OpenAiTranscriptionProvider(
      buildConfig(),
      noopUsageTracker(),
    );
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('sends a multipart request to the transcriptions endpoint with whisper-1, language auto-detected not forced (FR-105)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { text: 'hi' }));

    await provider.transcribe(
      Buffer.from('fake-audio'),
      'clip.mp3',
      'audio/mpeg',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
    const form = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    // A user may speak in any language (explicit product decision) — no
    // `language` field is sent at all, letting Whisper auto-detect instead
    // of assuming one.
    expect(form.get('language')).toBeNull();
    const file = form.get('file') as File;
    expect(file.name).toBe('clip.mp3');
  });

  it('resolves the transcribed text', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { text: 'someone serious who loves books' }),
    );
    await expect(
      provider.transcribe(Buffer.from('x'), 'a.mp3', 'audio/mpeg'),
    ).resolves.toBe('someone serious who loves books');
  });

  describe('fail-closed behavior', () => {
    it('throws ServiceUnavailableException on a network error', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      await expect(
        provider.transcribe(Buffer.from('x'), 'a.mp3', 'audio/mpeg'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(400, { error: 'bad audio' }));
      await expect(
        provider.transcribe(Buffer.from('x'), 'a.mp3', 'audio/mpeg'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException when the response has no text field', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));
      await expect(
        provider.transcribe(Buffer.from('x'), 'a.mp3', 'audio/mpeg'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException on an unparseable response body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('bad json')),
      });
      await expect(
        provider.transcribe(Buffer.from('x'), 'a.mp3', 'audio/mpeg'),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
