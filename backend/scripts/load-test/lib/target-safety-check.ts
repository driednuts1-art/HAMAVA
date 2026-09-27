/**
 * docs/load-testing.md — refuses to run against anything but an explicitly
 * allowlisted target, mirroring ProductionSafetyService's own real
 * "refuse to start unsafely" precedent (backend/src/common/production-safety),
 * enforced client-side here since this tool runs outside the server process
 * and has no other way to know it's about to hit production.
 */

const ALLOWED_BASE_URLS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

export function assertSafeTarget(baseUrl: string): void {
  if (!ALLOWED_BASE_URLS.includes(baseUrl)) {
    throw new Error(
      `Refusing to run the load test against "${baseUrl}" — not in the allowlist (${ALLOWED_BASE_URLS.join(', ')}). ` +
        'This tool must never run against a production or unrecognized target. ' +
        'If a new legitimate target genuinely needs adding (e.g. a dedicated Neon-branch-backed dev instance), ' +
        'add it explicitly here with real review — never bypass this check from the CLI.',
    );
  }
}
