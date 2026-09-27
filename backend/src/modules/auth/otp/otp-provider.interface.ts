export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

/**
 * Abstraction over the SMS/OTP delivery vendor. No business logic should ever
 * depend on a specific vendor's SDK — see docs/roadmap.md for the swap plan.
 */
export interface OtpProviderInterface {
  /** Deliver an OTP code to the given E.164 phone number. */
  sendOtp(phoneE164: string, code: string): Promise<void>;
}
