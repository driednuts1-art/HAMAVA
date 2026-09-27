import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OTP_PROVIDER } from '../../modules/auth/otp/otp-provider.interface';
import { LIVENESS_PROVIDER } from '../../modules/verification/liveness/liveness-provider.interface';
import { STORAGE_PROVIDER } from '../../modules/profile/storage/storage-provider.interface';
import { MALWARE_SCAN_PROVIDER } from '../../modules/profile/moderation/malware-scan-provider.interface';
import { CONTENT_MODERATION_PROVIDER } from '../moderation/content-moderation-provider.interface';
import { isMockProvider } from './mock-provider.marker';

interface CheckedProvider {
  name: string;
  instance: unknown;
}

/**
 * Refuses to finish starting the server in production if any vendor
 * provider is still a mock stand-in. Prevents the exact failure mode this
 * exists to catch: shipping mock OTP/liveness/storage/moderation to real
 * users because swapping in the real vendor was forgotten.
 *
 * Does nothing outside NODE_ENV=production (dev/test are expected to run on
 * mocks — see docs/roadmap.md).
 */
@Injectable()
export class ProductionSafetyService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductionSafetyService.name);

  constructor(
    @Inject(OTP_PROVIDER) private readonly otpProvider: unknown,
    @Inject(LIVENESS_PROVIDER) private readonly livenessProvider: unknown,
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: unknown,
    @Inject(MALWARE_SCAN_PROVIDER)
    private readonly malwareScanProvider: unknown,
    @Inject(CONTENT_MODERATION_PROVIDER)
    private readonly contentModerationProvider: unknown,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (
      process.env.NODE_ENV === 'production' &&
      this.config.get<string>('OTP_RATE_LIMIT_BYPASS') === 'true'
    ) {
      throw new Error(
        'Refusing to start in production with OTP_RATE_LIMIT_BYPASS=true — this is a test-only escape hatch (see test/jest-e2e.setup.ts).',
      );
    }

    if (
      process.env.NODE_ENV === 'production' &&
      this.config.get<string>('AUTH_OTP_DEBUG_ECHO') === 'true'
    ) {
      throw new Error(
        'Refusing to start in production with AUTH_OTP_DEBUG_ECHO=true — this is a test-only escape hatch (see docs/requirements.md Feature 14 FR-223, npm run start:frontend-e2e).',
      );
    }

    const checked: CheckedProvider[] = [
      { name: 'OTP_PROVIDER (SMS)', instance: this.otpProvider },
      { name: 'LIVENESS_PROVIDER', instance: this.livenessProvider },
      { name: 'STORAGE_PROVIDER (photos)', instance: this.storageProvider },
      { name: 'MALWARE_SCAN_PROVIDER', instance: this.malwareScanProvider },
      {
        name: 'CONTENT_MODERATION_PROVIDER',
        instance: this.contentModerationProvider,
      },
    ];

    const mocksStillWired = checked.filter((c) => isMockProvider(c.instance));

    if (mocksStillWired.length === 0) {
      this.logger.log(
        'Production safety check passed: no mock providers wired in.',
      );
      return;
    }

    const names = mocksStillWired.map((c) => c.name).join(', ');

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `Refusing to start in production with mock provider(s) still wired in: ${names}. ` +
          'See docs/roadmap.md for the real-vendor swap plan for each.',
      );
    }

    this.logger.warn(
      `Mock provider(s) in use (expected outside production): ${names}. See docs/roadmap.md.`,
    );
  }
}
