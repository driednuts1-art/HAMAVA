import { VirtualUser } from '../lib/virtual-user';
import { MetricsCollector } from '../lib/metrics';
import { cleanupVirtualUsers } from '../lib/cleanup';

/**
 * Standalone kill-switch scenario (docs/load-testing.md Decisions §4) —
 * deliberately NEVER combined with core-user-journey.ts or
 * ai-fanout-resilience.ts. A real kill-switch toggle needs a real backend
 * restart (today's switches are `.env` values read once at boot via
 * ConfigService) — doing that mid-way through a large concurrent run would
 * interrupt every other in-flight virtual user too, and the resulting
 * recovery-from-restart noise would be indistinguishable from the kill
 * switch's own real behavior, making the run uninterpretable.
 *
 * Run as two small, separate, operator-driven invocations — mirroring the
 * exact manual restart discipline already established and proven safe
 * throughout this project (Feature 18/19's own temporary env-toggle
 * verification passes):
 *
 *   1. `npx ts-node scripts/load-test/run.ts --scenario=kill-switch --phase=before`
 *      (backend running with the real default, VOICE_CALLS_ENABLED=true)
 *   2. Stop the backend, set VOICE_CALLS_ENABLED=false in backend/.env, restart it.
 *   3. `npx ts-node scripts/load-test/run.ts --scenario=kill-switch --phase=after`
 *   4. Flip VOICE_CALLS_ENABLED back to true in backend/.env, restart the
 *      backend again — leaving it in its correct default state.
 *
 * Uses VOICE_CALLS_ENABLED specifically (not AI_SEARCH_ENABLED) because
 * Feature 18 already established the exact real verification shape this
 * mirrors (a temporary env toggle + restart + a real assertion on the real
 * backend `detail` text), so the expected-correct behavior here is already
 * known and directly checkable, not guessed.
 */

const CONCURRENT_USERS = 5; // a handful, per Decisions §4 — this scenario is about correctness, not scale

export async function runKillSwitchToggle(
  baseUrl: string,
  phase: 'before' | 'after',
): Promise<void> {
  const metrics = new MetricsCollector();
  const users: VirtualUser[] = [];

  console.log(
    `\n--- Kill-switch scenario: phase="${phase}" ---\n` +
      (phase === 'before'
        ? 'Expecting VOICE_CALLS_ENABLED=true (the real default) — calls should start successfully.'
        : 'Expecting VOICE_CALLS_ENABLED=false — calls should fail with a real 503 and the real, distinguishing detail text.'),
  );

  try {
    // See core-user-journey.ts's identical fix — users are pushed as a real
    // side effect on each successful signup, and Promise.allSettled (not
    // Promise.all) so one real failure can't leave unsupervised background
    // creations orphaning rows after cleanup has already run. Low real
    // risk at this scenario's own small CONCURRENT_USERS count, but kept
    // consistent with the other two scenarios rather than assumed safe here.
    const creationResults = await Promise.allSettled(
      Array.from({ length: CONCURRENT_USERS }, async (_, i) => {
        const user = new VirtualUser(baseUrl);
        await user.signUp();
        users.push(user);
        await user.completeProfile(`KillSwitch-${phase}-${i}`);
      }),
    );
    const failedCreations = creationResults.filter(
      (r) => r.status === 'rejected',
    );
    if (failedCreations.length > 0) {
      console.warn(
        `[kill-switch] ${failedCreations.length}/${CONCURRENT_USERS} user creations failed — continuing with ${users.length} real users.`,
      );
    }

    // Pair users, form real matches, then attempt a real call start on each
    // pair — the actual endpoint the kill switch gates (Feature 18's own
    // FeatureEnabledGuard, mirrored exactly by Feature 12's date-share and
    // reused here for calls specifically).
    const pairs: [VirtualUser, VirtualUser][] = [];
    for (let i = 0; i + 1 < users.length; i += 2)
      pairs.push([users[i], users[i + 1]]);

    let sawExpectedOutcome = 0;
    for (const [a, b] of pairs) {
      const first = await a.swipe(b.userId, 'LIKE');
      const matchId = first.body.matched
        ? first.body.matchId
        : (await b.swipe(a.userId, 'LIKE')).body.matchId;
      if (!matchId) continue;

      const res = await metrics.time(
        'call-start',
        async () => {
          const r = await fetch(`${baseUrl}/v1/calls/${matchId}/start`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${a.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ type: 'VOICE' }),
          });
          const body = (await r.json().catch(() => ({}))) as {
            detail?: string;
          };
          return { status: r.status, body };
        },
        phase === 'after' ? [503] : [],
      );

      if (phase === 'before' && res.status === 201) sawExpectedOutcome += 1;
      if (phase === 'after' && res.status === 503) {
        sawExpectedOutcome += 1;
        const detail = res.body.detail ?? '';

        console.log(`[call-start] real 503 detail text: "${detail}"`);
      }
    }

    console.log(
      `\n[kill-switch] ${sawExpectedOutcome}/${pairs.length} pairs saw the expected "${phase}" outcome.`,
    );
    if (sawExpectedOutcome !== pairs.length) {
      console.warn(
        "[kill-switch] WARNING: not every pair saw the expected outcome — investigate before trusting this phase's result.",
      );
    }
  } finally {
    metrics.printSummary(`Kill-switch — phase=${phase}`);
    await cleanupVirtualUsers(users);
  }
}
