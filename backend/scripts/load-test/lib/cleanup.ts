import { VirtualUser } from './virtual-user';

/**
 * docs/load-testing.md — real, complete cleanup via the real
 * `DELETE /v1/users/me` flow (Feature 20), not a raw SQL DELETE. This
 * exercises the same real cascade/purge behavior Feature 6/20 already
 * tested, rather than sidestepping it, and leaves no synthetic data trail
 * on whichever database the run targeted.
 *
 * Deliberately continues past individual failures — one user's deletion
 * failing must not prevent every other user in the run from being cleaned
 * up. Called from a `finally` block by every scenario, so it also runs on
 * an aborted/errored run, not only a clean one.
 *
 * Deliberately does NOT retry-with-backoff on failure — an explicit user
 * decision. This tool is always run under direct human supervision, not as
 * an unattended background system, so a loud, impossible-to-miss failure
 * banner instructing a manual SQL fallback (already a real, proven,
 * documented path — used successfully three times during this tool's own
 * verification) is the correct response, not silent automatic retries that
 * could mask a real, worth-noticing backend condition (e.g. the real
 * global throttle, docs/load-testing.md's own "second real finding").
 */

let totalCleanupFailures = 0;

export function getTotalCleanupFailures(): number {
  return totalCleanupFailures;
}

const BANNER = '!'.repeat(78);

export async function cleanupVirtualUsers(users: VirtualUser[]): Promise<void> {
  if (users.length === 0) return;

  console.log(`\n[cleanup] deleting ${users.length} synthetic user(s)...`);
  let succeeded = 0;
  const failures: { phone: string; error: string }[] = [];

  for (const user of users) {
    try {
      await user.deleteAccount();
      succeeded += 1;
    } catch (err) {
      failures.push({
        phone: user.phone,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`[cleanup] ${succeeded}/${users.length} deleted successfully.`);
  if (failures.length > 0) {
    totalCleanupFailures += failures.length;
    // A loud, impossible-to-miss banner on stderr — not a plain log line
    // that scrolls away under later stages' own output. Per explicit user
    // direction: this tool never retries automatically, so the human
    // operator watching it run needs to see this and act.

    console.error(`\n${BANNER}`);

    console.error(
      `!!  MANUAL CLEANUP REQUIRED — ${failures.length} real user(s) NOT deleted, still real rows on the target database  !!`,
    );

    console.error(BANNER);

    console.error(
      'This tool does not retry cleanup automatically (docs/load-testing.md — an explicit ' +
        'decision, since this tool always runs under direct human supervision). ' +
        'Remove these rows by hand via a direct SQL DELETE against the load-test branch ' +
        "(scripts/load-test/.env.load-test.local's DATABASE_URL) — never the shared dev database.",
    );

    console.error('Failed users:');
    for (const f of failures) {
      console.error(`    ${f.phone}: ${f.error}`);
    }

    console.error(`${BANNER}\n`);
  }
}
