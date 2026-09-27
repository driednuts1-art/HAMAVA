import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { CryptoModule } from './common/crypto/crypto.module';
import { AuditLogModule } from './common/audit-log/audit-log.module';
import { ModerationModule } from './common/moderation/moderation.module';
import { AiEmbeddingModule } from './common/ai/ai-embedding.module';
import { AiTranscriptionModule } from './common/ai/ai-transcription.module';
import { AiUsageTrackerModule } from './common/ai/ai-usage-tracker.module';
import { AnalyticsEventModule } from './common/analytics/analytics-event.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthController } from './health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { VerificationModule } from './modules/verification/verification.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ConversationalSetupModule } from './modules/profile/conversational-setup/conversational-setup.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { SafetyModule } from './modules/safety/safety.module';
import { ChatModule } from './modules/chat/chat.module';
import { CallsModule } from './modules/calls/calls.module';
import { DateShareModule } from './modules/date-share/date-share.module';
import { AdminModule } from './modules/admin/admin.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ProductionSafetyModule } from './common/production-safety/production-safety.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Coarse global rate limit as defense-in-depth; endpoint-specific limits
    // (OTP, liveness) are enforced separately in their services against
    // persisted counters (product.md §8.3, requirements.md FR-4).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    RedisModule,
    CryptoModule,
    AuditLogModule,
    ModerationModule,
    AiEmbeddingModule,
    AiTranscriptionModule,
    AiUsageTrackerModule,
    AnalyticsEventModule,
    UsersModule,
    AuthModule,
    VerificationModule,
    ProfileModule,
    ConversationalSetupModule,
    DiscoveryModule,
    SafetyModule,
    ChatModule,
    CallsModule,
    DateShareModule,
    AdminModule,
    SettingsModule,
    ProductionSafetyModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
