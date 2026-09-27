import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { ProfileModule } from '../profile/profile.module';
import { DateShareController } from './date-share.controller';
import { PublicDateShareController } from './public-date-share.controller';
import { DateShareService } from './date-share.service';
import { DateShareRateLimitService } from './date-share-rate-limit.service';

@Module({
  imports: [
    AuthModule,
    // ConversationAccessService (FR-155's exact reused participant check).
    ChatModule,
    // STORAGE_PROVIDER (FR-165's reused presigned photo URL).
    ProfileModule,
  ],
  controllers: [DateShareController, PublicDateShareController],
  providers: [DateShareService, DateShareRateLimitService],
})
export class DateShareModule {}
