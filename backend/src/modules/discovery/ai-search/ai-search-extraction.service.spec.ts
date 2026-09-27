import { BadRequestException } from '@nestjs/common';
import type { AiSearchExtractionProviderInterface } from './extraction-provider.interface';
import type { TranscriptionProviderInterface } from '../../../common/ai/transcription-provider.interface';
import type { AiSearchRateLimitService } from './ai-search-rate-limit.service';
import { AiSearchExtractionService } from './ai-search-extraction.service';

const SAMPLE_FILTERS = {
  city: null,
  minAge: null,
  maxAge: null,
  gender: [],
  relationshipGoal: [],
  semanticQuery: 'x',
};

describe('AiSearchExtractionService', () => {
  let service: AiSearchExtractionService;
  let rateLimit: jest.Mocked<AiSearchRateLimitService>;
  let extractionProvider: jest.Mocked<AiSearchExtractionProviderInterface>;
  let transcriptionProvider: jest.Mocked<TranscriptionProviderInterface>;

  beforeEach(() => {
    rateLimit = {
      enforce: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AiSearchRateLimitService>;
    extractionProvider = {
      extractFilters: jest.fn().mockResolvedValue(SAMPLE_FILTERS),
    };
    transcriptionProvider = {
      transcribe: jest.fn().mockResolvedValue('transcribed text'),
    };
    service = new AiSearchExtractionService(
      rateLimit,
      extractionProvider,
      transcriptionProvider,
    );
  });

  describe('extractFromText (FR-103, FR-104)', () => {
    it('enforces the TEXT rate limit before extracting', async () => {
      await service.extractFromText('user-1', 'a prompt');
      expect(rateLimit.enforce).toHaveBeenCalledWith('user-1', 'TEXT');
      expect(extractionProvider.extractFilters).toHaveBeenCalledWith(
        'a prompt',
      );
    });

    it('propagates a rate-limit rejection without calling the vendor', async () => {
      rateLimit.enforce.mockRejectedValue(new Error('429'));
      await expect(service.extractFromText('user-1', 'x')).rejects.toThrow(
        '429',
      );
      expect(extractionProvider.extractFilters).not.toHaveBeenCalled();
    });
  });

  describe('transcribeAndExtract (FR-105..FR-108)', () => {
    it('rejects an unsupported audio format before any rate-limit charge or vendor call (FR-107)', async () => {
      await expect(
        service.transcribeAndExtract(
          'user-1',
          Buffer.from('x'),
          'clip.ogg',
          'audio/ogg',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(rateLimit.enforce).not.toHaveBeenCalled();
      expect(transcriptionProvider.transcribe).not.toHaveBeenCalled();
    });

    it.each(['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'])(
      'accepts the .%s extension (confirmed against real OpenAI docs, Open Items #5)',
      async (ext) => {
        await expect(
          service.transcribeAndExtract(
            'user-1',
            Buffer.from('x'),
            `clip.${ext}`,
            'audio/whatever',
          ),
        ).resolves.toBeDefined();
      },
    );

    it('is case-insensitive on the extension', async () => {
      await expect(
        service.transcribeAndExtract(
          'user-1',
          Buffer.from('x'),
          'CLIP.MP3',
          'audio/mpeg',
        ),
      ).resolves.toBeDefined();
    });

    it('enforces the VOICE rate limit, transcribes, then feeds the transcript through the identical extraction call as text (FR-108)', async () => {
      const result = await service.transcribeAndExtract(
        'user-1',
        Buffer.from('audio-bytes'),
        'clip.mp3',
        'audio/mpeg',
      );

      expect(rateLimit.enforce).toHaveBeenCalledWith('user-1', 'VOICE');
      expect(transcriptionProvider.transcribe).toHaveBeenCalledWith(
        Buffer.from('audio-bytes'),
        'clip.mp3',
        'audio/mpeg',
      );
      expect(extractionProvider.extractFilters).toHaveBeenCalledWith(
        'transcribed text',
      );
      expect(result).toEqual({
        transcribedText: 'transcribed text',
        filters: SAMPLE_FILTERS,
      });
    });

    it('propagates a rate-limit rejection without ever calling the transcription vendor', async () => {
      rateLimit.enforce.mockRejectedValue(new Error('429'));
      await expect(
        service.transcribeAndExtract(
          'user-1',
          Buffer.from('x'),
          'clip.mp3',
          'audio/mpeg',
        ),
      ).rejects.toThrow('429');
      expect(transcriptionProvider.transcribe).not.toHaveBeenCalled();
    });
  });
});
