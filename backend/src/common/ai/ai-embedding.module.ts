import { Global, Module } from '@nestjs/common';
import { EMBEDDING_PROVIDER } from './embedding-provider.interface';
import { OpenAiEmbeddingProvider } from './openai-embedding.provider';

// Global: both ProfileModule (FR-112, precompute on bio/interests write) and
// the discovery AiSearchModule (FR-111, query-time embedding) need this —
// one shared provider, not two separate OpenAI clients.
@Global()
@Module({
  providers: [
    { provide: EMBEDDING_PROVIDER, useClass: OpenAiEmbeddingProvider },
  ],
  exports: [EMBEDDING_PROVIDER],
})
export class AiEmbeddingModule {}
