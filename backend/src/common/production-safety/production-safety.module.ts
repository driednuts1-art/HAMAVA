import { Module } from '@nestjs/common';
import { AuthModule } from '../../modules/auth/auth.module';
import { VerificationModule } from '../../modules/verification/verification.module';
import { ProfileModule } from '../../modules/profile/profile.module';
import { ProductionSafetyService } from './production-safety.service';

@Module({
  imports: [AuthModule, VerificationModule, ProfileModule],
  providers: [ProductionSafetyService],
})
export class ProductionSafetyModule {}
