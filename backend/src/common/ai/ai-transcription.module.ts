import { Global, Module } from '@nestjs/common';
import { TRANSCRIPTION_PROVIDER } from './transcription-provider.interface';
import { OpenAiTranscriptionProvider } from './openai-transcription.provider';

// Global: both the discovery AiSearchModule (FR-105, voice search) and
// ProfileModule's conversational-setup submodule (FR-137, voice turns) need
// this — one shared Whisper client, not two separate OpenAI clients. Mirrors
// AiEmbeddingModule's exact reasoning for the same kind of cross-feature reuse.
@Global()
@Module({
  providers: [
    { provide: TRANSCRIPTION_PROVIDER, useClass: OpenAiTranscriptionProvider },
  ],
  exports: [TRANSCRIPTION_PROVIDER],
})
export class AiTranscriptionModule {}
