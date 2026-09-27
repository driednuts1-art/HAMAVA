import { registerGracefulShutdown } from '../src/common/graceful-shutdown';

/**
 * Spawned as a real child process by
 * test/graceful-shutdown-signal.e2e-spec.ts and sent a real SIGTERM/SIGINT,
 * so the test proves the actual exported registerGracefulShutdown() reacts
 * correctly to a real OS signal — not a re-typed stand-in for it.
 *
 * onShutdown is stubbed (no real Prisma/Redis/HTTP server here) since this
 * probe exists only to exercise the signal-handling/timeout-race logic
 * itself; main.ts wires the same function to the real cleanup work.
 */
const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS ?? 5000);
const shutdownDelayMs = Number(process.env.PROBE_SHUTDOWN_DELAY_MS ?? 0);

// A bare `process.on('SIGTERM', ...)` does NOT keep Node's event loop alive
// by itself (verified empirically) — in main.ts the real HTTP server (from
// app.listen()) is what keeps the process running until a signal arrives.
// This probe has no server, so it needs an equivalent ref'd keep-alive or
// it would exit on its own the instant the synchronous top level finishes,
// before any signal could ever reach it.
setInterval(() => {}, 1 << 30);

registerGracefulShutdown({
  timeoutMs,
  onShutdown: async () => {
    console.log('PROBE_ONSHUTDOWN_CALLED');
    if (shutdownDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, shutdownDelayMs));
    }
    console.log('PROBE_ONSHUTDOWN_DONE');
  },
  exit: (code) => {
    // console.log()'s write to a piped stdout is async — calling process.exit()
    // right after it can truncate the write before the parent ever sees it.
    // Wait for the write callback so the parent reliably observes this line.
    process.stdout.write(`PROBE_EXIT ${code}\n`, () => process.exit(code));
  },
});

console.log('PROBE_READY');

// Self-timeout fallback: if this process is somehow never signaled (e.g. a
// broken test harness), don't hang the test suite forever.
setTimeout(() => {
  console.log('PROBE_NEVER_SIGNALED');
  process.exit(2);
}, 30000).unref();
