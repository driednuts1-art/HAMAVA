import { Global, Module } from '@nestjs/common';
import { AiUsageTrackerService } from './ai-usage-tracker.service';

/**
 * Feature 21 (FR-298): global so every OpenAi*Provider across every module
 * (common/ai, common/moderation, discovery/ai-search,
 * discovery/match-explanation, profile/conversational-setup) can inject it
 * without each owning module separately importing this one — mirrors
 * AuditLogModule's/CryptoModule's exact existing precedent for a small,
 * universally-needed service.
 */
@Global()
@Module({
  providers: [AiUsageTrackerService],
  exports: [AiUsageTrackerService],
})
export class AiUsageTrackerModule {}
