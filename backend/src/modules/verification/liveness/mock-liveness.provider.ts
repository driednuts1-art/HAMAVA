import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  LivenessProviderInterface,
  LivenessSessionResult,
} from './liveness-provider.interface';
import { MockProviderMarker } from '../../../common/production-safety/mock-provider.marker';

/**
 * MOCK — always returns `pass`, immediately, with no real biometric capture
 * or processing involved. For exercising the onboarding flow only.
 *
 * DO NOT connect a real liveness vendor to this code path before a Data
 * Protection Impact Assessment (DPIA) is complete — see
 * legal-checklist.md Part B and docs/roadmap.md §2.
 */
@Injectable()
export class MockLivenessProvider
  implements LivenessProviderInterface, MockProviderMarker
{
  readonly isMock = true as const;
  private readonly logger = new Logger(
    'MockLivenessProvider [MOCK - always passes]',
  );

  startSession(userId: string): Promise<LivenessSessionResult> {
    this.logger.warn(
      `Mock liveness check for user ${userId}: auto-PASS (no real verification performed)`,
    );
    return Promise.resolve({
      providerSessionRef: `mock-${randomUUID()}`,
      status: 'pass',
    });
  }
}
