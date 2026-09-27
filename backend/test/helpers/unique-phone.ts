const run = Date.now().toString().slice(-7);
let counter = 0;

/**
 * A guaranteed-unique, E.164-valid phone number for e2e tests. Reusing a
 * phone number reuses the same underlying user (OTP verify is idempotent
 * per phone), silently inheriting whatever state an earlier call already
 * gave that user — a hand-picked-digit collision (too few digits for the
 * number of users a file actually needed, or two different tests picking
 * the same one) independently recurred across Feature 9, 10, 11, and 12's
 * own e2e suites before being centralized here. Every e2e test that needs
 * a fresh user should call this instead of hand-rolling a phone string.
 */
export function uniquePhone(): string {
  const seq = (counter++).toString().padStart(5, '0');
  return `+1${run}${seq}`;
}
