import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileModule } from '../profile/profile.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AccountDeletionService } from './account-deletion.service';

// docs/requirements.md Feature 6 Open Items #5: a new module, not UsersModule
// — UsersModule can't import AuthModule (needed for JwtAuthGuard/OtpService)
// without creating a cycle, since AuthModule already imports UsersModule.
@Module({
  imports: [AuthModule, ProfileModule],
  controllers: [SettingsController],
  providers: [SettingsService, AccountDeletionService],
})
export class SettingsModule {}
