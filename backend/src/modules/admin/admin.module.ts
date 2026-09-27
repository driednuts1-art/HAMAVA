import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SafetyModule } from '../safety/safety.module';
import { AdminController } from './admin.controller';
import { ModerationController } from './moderation.controller';
import { AdminGuard } from './guards/admin.guard';

@Module({
  // ModerationFlagService doesn't need to be imported here — it's exported
  // from the @Global() ModerationModule (Feature 8), reachable everywhere.
  imports: [AuthModule, SafetyModule],
  controllers: [AdminController, ModerationController],
  providers: [AdminGuard],
})
export class AdminModule {}
