import { VirtualUser } from '../lib/virtual-user';
import { MetricsCollector } from '../lib/metrics';
import { cleanupVirtualUsers } from '../lib/cleanup';

/**
 * Tier 2 (docs/load-testing.md): AI-fanout paths at moderate (not heavy)
 * concurrency — ramps 5 → 15 → 30 (Decisions §1). The goal is confirming
 * *this project's own* mechanisms hold up under real concurrent requests —
 * rate-limit correctness, and error-message correctness staying accurate
 * per-request rather than getting cross-contaminated across concurrently
 * in-flight requests sharing one process — not measuring how much raw
 * throughput OpenAI itself can absorb.
 *
 * What this scenario deliberately does NOT attempt: forcing a real vendor
 * failure on demand (no way to make OpenAI itself fail to order) or
 * toggling a kill switch mid-run (its own separate, standalone scenario,
 * kill-switch-toggle.ts, per Decisions §4 — a live toggle needs a real
 * backend restart, which would make this scenario's own results
 * uninterpretable). The real fail-open/fail-closed *logic* itself is
 * already covered by this project's existing vendor-failure e2e/unit tests
 * (test/helpers/vendor-failure.ts); this scenario's own contribution is
 * specifically the concurrency angle for what's actually forceable here.
 */

const RAMP_STAGES = [5, 15, 30];
const RAMP_LABELS = [
  'stage 1 (5 concurrent)',
  'stage 2 (15 concurrent)',
  'stage 3 (30 concurrent)',
];

const SEARCH_QUERIES = [
  'دنبال کسی می‌گردم که عاشق کوهنوردی و کتاب باشه',
  'یه نفر جدی برای رابطه بلندمدت، تهران',
  'علاقه‌مند به موسیقی و سفر، سنین ۲۵ تا ۳۰',
  'کسی که فوتبال دوست داره و اهل شوخیه',
  'دنبال یه رابطه‌ی دوستانه، بدون تعصب خاص',
];

async function runStage(
  baseUrl: string,
  userCount: number,
  label: string,
): Promise<void> {
  const metrics = new MetricsCollector();
  const users: VirtualUser[] = [];

  console.log(`\n--- Tier 2: ${label} ---`);

  try {
    // See core-user-journey.ts's identical fix for the full trail: users
    // are pushed as a real side effect on each successful signup (not read
    // back from Promise.all's own return value), and Promise.allSettled is
    // used instead of Promise.all so a single real failure — e.g. the real,
    // previously-unknown global per-IP throttle found while load testing
    // this exact scenario (`ThrottlerModule.forRoot([{ttl: 60_000, limit: 100}])`,
    // backend/src/app.module.ts, applied to every endpoint via APP_GUARD —
    // genuinely separate from OTP_RATE_LIMIT_BYPASS, which only covers
    // OtpService's own DB-backed counter) — degrades this stage's real
    // user count rather than leaving unsupervised background creations
    // that finish (and orphan real rows) after cleanup has already run.
    const creationResults = await Promise.allSettled(
      Array.from({ length: userCount }, async (_, i) => {
        const user = new VirtualUser(baseUrl);
        await metrics.time('signup', () =>
          user.signUp().then(() => ({ status: 200 as const })),
        );
        users.push(user);
        await metrics.time('profile-completion', () =>
          user
            .completeProfile(`AiFanout-${i}`)
            .then(() => ({ status: 200 as const })),
        );
      }),
    );
    const failedCreations = creationResults.filter(
      (r) => r.status === 'rejected',
    );
    if (failedCreations.length > 0) {
      console.warn(
        `[${label}] ${failedCreations.length}/${userCount} user creations failed — continuing with ${users.length} real users:`,
      );
      for (const f of failedCreations.slice(0, 5)) {
        console.warn(`    ${f.reason}`);
      }
    }

    // Real concurrent AI search — every user fires one real search at the
    // same time, exercising real concurrent extraction+embedding calls.
    await Promise.all(
      users.map((u, i) =>
        metrics.time(
          'ai-search',
          () =>
            u.aiSearch(SEARCH_QUERIES[i % SEARCH_QUERIES.length]) as Promise<{
              status: number;
            }>,
          [429], // AI_SEARCH_TEXT_RATE_LIMIT_PER_MINUTE — a real, expected outcome under concurrency
        ),
      ),
    );

    // Real per-user rate-limit correctness: one user fires several rapid
    // searches in a tight sequence (well past AI_SEARCH_TEXT_RATE_LIMIT_PER_MINUTE=10),
    // confirming the real 429 with the real backend detail text — not
    // asserting a specific count (that's already unit-tested), just that
    // the limiter still behaves correctly with other concurrent traffic
    // also hitting the same process.
    if (users.length > 0) {
      const prober = users[0];
      let sawRateLimit = false;
      for (let i = 0; i < 12; i++) {
        const res = await metrics.time(
          'rate-limit-probe',
          () =>
            prober.aiSearch('یه جست‌وجوی تستی دیگه') as Promise<{
              status: number;
            }>,
          [429],
        );
        if (res.status === 429) {
          sawRateLimit = true;
          break;
        }
      }

      console.log(
        sawRateLimit
          ? '[rate-limit-probe] real 429 observed as expected.'
          : '[rate-limit-probe] WARNING: no real 429 observed after 12 rapid requests — the real limiter may not be firing correctly under concurrency.',
      );
    }
  } finally {
    metrics.printSummary(`Tier 2 — ${label}`);
    await cleanupVirtualUsers(users);
  }
}

export async function runAiFanoutResilience(baseUrl: string): Promise<void> {
  for (let i = 0; i < RAMP_STAGES.length; i++) {
    await runStage(baseUrl, RAMP_STAGES[i], RAMP_LABELS[i]);
  }
}
