import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlockService } from './block.service';
import { ReportService } from './report.service';
import { ReportRateLimitService } from './report-rate-limit.service';
import { UserSafetyService } from './user-safety.service';
import { SafetyController } from './safety.controller';

@Module({
  imports: [AuthModule],
  controllers: [SafetyController],
  providers: [
    BlockService,
    ReportService,
    ReportRateLimitService,
    UserSafetyService,
  ],
  exports: [BlockService, ReportService],
})
export class SafetyModule {}
