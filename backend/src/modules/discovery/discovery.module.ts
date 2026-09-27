import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { ProfileModule } from '../profile/profile.module';
import { PresenceModule } from '../presence/presence.module';
import { DeckController } from './deck.controller';
import { DeckService } from './deck.service';
import { SwipeController } from './swipe.controller';
import { SwipeService } from './swipe.service';
import { MatchController } from './match.controller';
import { MatchService } from './match.service';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';
import { AiSearchController } from './ai-search/ai-search.controller';
import { AiSearchService } from './ai-search/ai-search.service';
import { AiSearchExtractionService } from './ai-search/ai-search-extraction.service';
import { AiSearchRateLimitService } from './ai-search/ai-search-rate-limit.service';
import { AI_SEARCH_EXTRACTION_PROVIDER } from './ai-search/extraction-provider.interface';
import { OpenAiExtractionProvider } from './ai-search/openai-extraction.provider';
import { BoostController } from './boost.controller';
import { BoostService } from './boost.service';
import { MatchExplanationService } from './match-explanation/match-explanation.service';
import { MATCH_EXPLANATION_PROVIDER } from './match-explanation/match-explanation-provider.interface';
import { OpenAiMatchExplanationProvider } from './match-explanation/openai-match-explanation.provider';
import { MatchFeedbackController } from './match-feedback.controller';
import { MatchFeedbackService } from './match-feedback.service';
import { WhoLikedMeController } from './who-liked-me.controller';
import { WhoLikedMeService } from './who-liked-me.service';

@Module({
  imports: [
    AuthModule,
    ProfileModule,
    PresenceModule,
    // Feature 9 (FR-107): a separate Multer config from ProfileModule's own
    // (different limit, different feature) — module-scoped, so this only
    // applies to AiSearchController's `transcribe` endpoint.
    MulterModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: config.getOrThrow<number>('AI_SEARCH_MAX_AUDIO_BYTES'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    DeckController,
    SwipeController,
    MatchController,
    PreferencesController,
    AiSearchController,
    BoostController,
    MatchFeedbackController,
    WhoLikedMeController,
  ],
  providers: [
    DeckService,
    SwipeService,
    MatchService,
    PreferencesService,
    AiSearchService,
    AiSearchExtractionService,
    AiSearchRateLimitService,
    BoostService,
    MatchExplanationService,
    MatchFeedbackService,
    WhoLikedMeService,
    // Real providers — OpenAI (docs/requirements.md Feature 9, Open Items #1).
    {
      provide: AI_SEARCH_EXTRACTION_PROVIDER,
      useClass: OpenAiExtractionProvider,
    },
    // TRANSCRIPTION_PROVIDER now comes from the global AiTranscriptionModule
    // (common/ai/) — shared with Feature 11's conversational voice turns.
    // Real provider — OpenAI (docs/requirements.md Feature 10, Open Items #5).
    {
      provide: MATCH_EXPLANATION_PROVIDER,
      useClass: OpenAiMatchExplanationProvider,
    },
  ],
})
export class DiscoveryModule {}
