import { VirtualUser } from '../lib/virtual-user';
import { MetricsCollector } from '../lib/metrics';
import { cleanupVirtualUsers } from '../lib/cleanup';

/**
 * Tier 1 (docs/load-testing.md): does the system's own infrastructure —
 * Neon connection pool, Redis pub/sub, the NestJS process, real Socket.IO
 * delivery — hold up under many concurrent real users doing the app's core
 * loop (signup, deck, swipe/match, chat, settings). Ramps 10 → 50 → 100
 * concurrent virtual users (Decisions §1), each stage independently
 * measured and cleaned up before the next.
 */

const RAMP_STAGES = [10, 50, 100];
const RAMP_LABELS = [
  'stage 1 (10 users)',
  'stage 2 (50 users)',
  'stage 3 (100 users)',
];

async function runStage(
  baseUrl: string,
  userCount: number,
  label: string,
): Promise<void> {
  const metrics = new MetricsCollector();
  const users: VirtualUser[] = [];

  console.log(`\n--- Tier 1: ${label} ---`);

  try {
    // Signup + profile completion — real, concurrent, per-user work.
    //
    // Two real bugs were found and fixed here across the first two real
    // runs against the load-test branch, not anticipated in the initial
    // draft. First: `users` was originally populated from `Promise.all(...)`'s
    // own return value — a single rejection anywhere in the batch discards
    // the whole return value, silently losing cleanup coverage for every
    // *other* user already created (confirmed directly: 63 real, uncleaned
    // rows left on the branch database, found and removed by hand). Fixing
    // that by pushing each user into `users` on its own successful signup
    // (a real side effect, not deferred) surfaced the second, deeper bug:
    // `Promise.all` rejecting on the *first* failure does not stop or wait
    // for the other N-1 still-in-flight creations — they keep running as
    // unsupervised background work, still creating real users (and,
    // crucially, still pushing into `users`) *after* this try/finally has
    // already unwound and `cleanupVirtualUsers()` has already run to
    // completion — confirmed directly again: a second run left 62 more
    // orphaned rows, this time via that exact mechanism. `Promise.allSettled`
    // is the real fix: every creation attempt genuinely finishes (success
    // or failure) before this step is considered done, so `users` is
    // complete and stable by the time cleanup runs, and one real failure
    // (e.g. the global per-IP throttle, see ai-fanout-resilience.ts's own
    // note) degrades the stage's own user count rather than aborting the
    // whole run.
    const creationResults = await Promise.allSettled(
      Array.from({ length: userCount }, async (_, i) => {
        const user = new VirtualUser(baseUrl);
        await metrics.time('signup', () =>
          user.signUp().then(() => ({ status: 200 as const })),
        );
        users.push(user);
        await metrics.time('profile-completion', () =>
          user
            .completeProfile(`LoadTest-${i}`)
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

    // Real deck fetch + real settings read for every user — cheap, no
    // vendor fanout, a real "floor" measurement.
    await Promise.all(
      users.map((u) =>
        Promise.all([
          metrics.time('deck-fetch', () => u.fetchDeck()),
          metrics.time('settings-read', () => u.getSettings()),
        ]),
      ),
    );

    // Pair users up (2i, 2i+1) and form a real match via two real swipes
    // each — mirrors backend/test/chat.e2e-spec.ts's own createMatch shape.
    const pairs: [VirtualUser, VirtualUser][] = [];
    for (let i = 0; i + 1 < users.length; i += 2) {
      pairs.push([users[i], users[i + 1]]);
    }

    const matchIds = await Promise.all(
      pairs.map(async ([a, b]) => {
        const first = await metrics.time('swipe', () =>
          a.swipe(b.userId, 'LIKE'),
        );
        if (first.body.matched) return first.body.matchId!;
        const second = await metrics.time('swipe', () =>
          b.swipe(a.userId, 'LIKE'),
        );
        return second.body.matchId ?? null;
      }),
    );

    // Real chat: both sides connect a real WebSocket, one sends via REST,
    // the other's real socket must receive `message:new` — the one metric
    // single-pair e2e tests structurally can't produce at this concurrency.
    await Promise.all(
      pairs.map(async ([a, b], i) => {
        const matchId = matchIds[i];
        if (!matchId) return;
        const [, socketB] = await Promise.all([
          a.connectChatSocket(),
          b.connectChatSocket(),
        ]);
        const delivered = new Promise<void>((resolve) => {
          socketB.once('message:new', () => resolve());
        });
        await metrics.time('message-send', () =>
          a.sendMessage(matchId, `سلام از یوزر ${i}`),
        );

        const deliveryStart = Date.now();
        const timedOut = await Promise.race([
          delivered.then(() => false),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(true), 10_000),
          ),
        ]);
        metrics.recordLatency(
          'ws-delivery',
          Date.now() - deliveryStart,
          timedOut ? 504 : 200,
        );

        a.disconnectChatSocket();
        b.disconnectChatSocket();
      }),
    );
  } finally {
    metrics.printSummary(`Tier 1 — ${label}`);
    await cleanupVirtualUsers(users);
  }
}

export async function runCoreUserJourney(baseUrl: string): Promise<void> {
  for (let i = 0; i < RAMP_STAGES.length; i++) {
    await runStage(baseUrl, RAMP_STAGES[i], RAMP_LABELS[i]);
  }
}
