import { Global, Module } from '@nestjs/common';
import { ProfileModule } from '../../modules/profile/profile.module';
import { CONTENT_MODERATION_PROVIDER } from './content-moderation-provider.interface';
import { OpenAiContentModerationProvider } from './openai-content-moderation.provider';
import { ModerationFlagService } from './moderation-flag.service';

@Global()
@Module({
  // ProfileModule for STORAGE_PROVIDER — ModerationFlagService quarantines
  // flagged photos in the same bucket (FR-97). One-way dependency, no cycle:
  // ProfileModule doesn't need to import ModerationModule back (this module
  // is @Global(), so its exports reach ProfileModule without that).
  imports: [ProfileModule],
  // Real provider — OpenAI Moderation API (docs/roadmap.md §5, Feature 8).
  providers: [
    {
      provide: CONTENT_MODERATION_PROVIDER,
      useClass: OpenAiContentModerationProvider,
    },
    ModerationFlagService,
  ],
  exports: [CONTENT_MODERATION_PROVIDER, ModerationFlagService],
})
export class ModerationModule {}
