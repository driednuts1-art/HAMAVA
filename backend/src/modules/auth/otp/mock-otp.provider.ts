import { Injectable, Logger } from '@nestjs/common';
import { OtpProviderInterface } from './otp-provider.interface';
import { MockProviderMarker } from '../../../common/production-safety/mock-provider.marker';

/**
 * MOCK — logs the OTP instead of sending a real SMS. No real vendor is wired
 * up yet; see docs/roadmap.md §1 for why (sanctions/export-control review
 * pending for the target market, product.md §17 / legal-checklist.md Part E).
 *
 * Swap: implement OtpProviderInterface with the chosen vendor's SDK and
 * rebind OTP_PROVIDER in AuthModule. No other code changes required.
 */
@Injectable()
export class MockOtpProvider
  implements OtpProviderInterface, MockProviderMarker
{
  readonly isMock = true as const;
  private readonly logger = new Logger(
    'MockOtpProvider [MOCK - no real SMS sent]',
  );

  sendOtp(phoneE164: string, code: string): Promise<void> {
    this.logger.warn(
      `OTP for ${phoneE164}: ${code} (mock — not actually sent)`,
    );
    return Promise.resolve();
  }
}
