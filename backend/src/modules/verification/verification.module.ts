import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConsentController } from './consent.controller';
import { LivenessController } from './liveness.controller';
import { LIVENESS_PROVIDER } from './liveness/liveness-provider.interface';
import { MockLivenessProvider } from './liveness/mock-liveness.provider';
import { VerificationService } from './verification.service';

@Module({
  imports: [AuthModule],
  controllers: [ConsentController, LivenessController],
  providers: [
    VerificationService,
    // MOCK provider — do not connect a real vendor before a DPIA is complete. See docs/roadmap.md §2.
    { provide: LIVENESS_PROVIDER, useClass: MockLivenessProvider },
  ],
  // LIVENESS_PROVIDER is exported so ProductionSafetyService can check it's not a mock.
  exports: [LIVENESS_PROVIDER],
})
export class VerificationModule {}
