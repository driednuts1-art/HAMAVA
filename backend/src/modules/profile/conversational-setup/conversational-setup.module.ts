import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../../auth/auth.module';
import { ProfileModule } from '../profile.module';
import { ConversationalSetupController } from './conversational-setup.controller';
import { ConversationalSetupService } from './conversational-setup.service';
import { ConversationalSetupSessionStore } from './conversational-setup-session.store';
import { ConversationalSetupRateLimitService } from './conversational-setup-rate-limit.service';
import { CONVERSATIONAL_EXTRACTION_PROVIDER } from './conversational-extraction-provider.interface';
import { OpenAiConversationalExtractionProvider } from './openai-conversational-extraction.provider';

@Module({
  imports: [
    AuthModule,
    // Exports ProfileService (FR-141's shared write path). TRANSCRIPTION_PROVIDER
    // comes from the global AiTranscriptionModule, not from ProfileModule.
    ProfileModule,
    // Own Multer config (FR-137) — separate from ProfileModule's own
    // (different limit, different feature), same reasoning as Feature 9's
    // separate registration in discovery.module.ts.
    MulterModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: config.getOrThrow<number>(
            'CONVERSATIONAL_SETUP_MAX_AUDIO_BYTES',
          ),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ConversationalSetupController],
  providers: [
    ConversationalSetupService,
    ConversationalSetupSessionStore,
    ConversationalSetupRateLimitService,
    // Real provider — OpenAI (docs/requirements.md Feature 11, Open Items #7).
    {
      provide: CONVERSATIONAL_EXTRACTION_PROVIDER,
      useClass: OpenAiConversationalExtractionProvider,
    },
  ],
})
export class ConversationalSetupModule {}
