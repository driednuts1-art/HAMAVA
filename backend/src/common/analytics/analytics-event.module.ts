import { Global, Module } from '@nestjs/common';
import { ANALYTICS_EVENT_PROVIDER } from './analytics-event-provider.interface';
import { MockAnalyticsEventProvider } from './mock-analytics-event.provider';

// Global: ProfileModule (FR-152, profile_completed) is the only consumer
// today, but this mirrors every other cross-cutting provider module in this
// project (AiEmbeddingModule, AiTranscriptionModule) rather than being
// scoped to one feature module, since analytics is inherently cross-cutting.
@Global()
@Module({
  providers: [
    { provide: ANALYTICS_EVENT_PROVIDER, useClass: MockAnalyticsEventProvider },
  ],
  exports: [ANALYTICS_EVENT_PROVIDER],
})
export class AnalyticsEventModule {}
