import { spawn } from 'child_process';
import * as path from 'path';

/**
 * Real cross-process SIGTERM/SIGINT delivery to the actual exported
 * registerGracefulShutdown() (via scripts/graceful-shutdown-probe.ts),
 * not a hand-typed reconstruction of its logic — replaces the earlier
 * one-off manual WSL script run with a permanent, repeatable test
 * (docs/architecture.md §5.3).
 *
 * POSIX-only: process signals don't map onto Windows the same way, so this
 * is a deliberate no-op there rather than a false pass/fail. It runs for
 * real on Linux/WSL/CI.
 */
const describeOrSkip = process.platform === 'win32' ? describe.skip : describe;

describeOrSkip('graceful shutdown — real OS signal delivery', () => {
  const probeScript = path.join(
    __dirname,
    '..',
    'scripts',
    'graceful-shutdown-probe.ts',
  );
  const tsNodeBin = path.join(
    __dirname,
    '..',
    'node_modules',
    '.bin',
    'ts-node',
  );

  function spawnProbe(env: Record<string, string> = {}) {
    return spawn(tsNodeBin, [probeScript], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  function waitForLine(
    child: ReturnType<typeof spawn>,
    marker: string,
    timeoutMs = 10000,
  ) {
    return new Promise<void>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `Timed out waiting for "${marker}". Output so far:\n${buffer}`,
            ),
          ),
        timeoutMs,
      );
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        if (buffer.includes(marker)) {
          clearTimeout(timer);
          child.stdout?.off('data', onData);
          resolve();
        }
      };
      child.stdout?.on('data', onData);
    });
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  // Verified empirically: with a warm ts-node compile cache the probe's
  // entire module-load-to-registered-handler sequence can finish in under
  // 2ms — faster than the OS reliably arms the new sigaction() before a
  // signal sent that quickly arrives, so an immediate kill() right after
  // seeing PROBE_READY was flaky (default-terminated instead of running our
  // handler). A short settle delay after readiness fixes it deterministically.
  // This has no bearing on main.ts in production: Nest's real bootstrap
  // (DB/Redis connections, HTTP listen) always takes far longer than this.
  const SIGNAL_SETTLE_MS = 300;

  function waitForExit(child: ReturnType<typeof spawn>, timeoutMs = 10000) {
    // 'close' (not 'exit') — fires only after stdio pipes are fully flushed,
    // so output captured via the 'data' listeners above is guaranteed complete.
    return new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for process exit')),
        timeoutMs,
      );
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  it('shuts down cleanly on real SIGTERM', async () => {
    const child = spawnProbe();
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

    await waitForLine(child, 'PROBE_READY');
    await sleep(SIGNAL_SETTLE_MS);
    child.kill('SIGTERM');

    const code = await waitForExit(child);

    expect(output).toContain('PROBE_ONSHUTDOWN_CALLED');
    expect(output).toContain('PROBE_ONSHUTDOWN_DONE');
    expect(output).toContain('PROBE_EXIT 0');
    expect(code).toBe(0);
  }, 15000);

  it('shuts down cleanly on real SIGINT', async () => {
    const child = spawnProbe();
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

    await waitForLine(child, 'PROBE_READY');
    await sleep(SIGNAL_SETTLE_MS);
    child.kill('SIGINT');

    const code = await waitForExit(child);

    expect(output).toContain('PROBE_ONSHUTDOWN_CALLED');
    expect(output).toContain('PROBE_EXIT 0');
    expect(code).toBe(0);
  }, 15000);

  it('forces exit via the fail-safe timeout when cleanup hangs past it', async () => {
    const child = spawnProbe({
      PROBE_TIMEOUT_MS: '1000',
      PROBE_SHUTDOWN_DELAY_MS: '10000', // cleanup deliberately outlives the timeout
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

    await waitForLine(child, 'PROBE_READY');
    await sleep(SIGNAL_SETTLE_MS);
    child.kill('SIGTERM');

    const code = await waitForExit(child, 15000);

    expect(output).toContain('PROBE_ONSHUTDOWN_CALLED');
    expect(output).not.toContain('PROBE_ONSHUTDOWN_DONE'); // the 10s delay never got to finish
    expect(output).toContain('PROBE_EXIT 0'); // forced by the timeout branch, not by cleanup finishing
    expect(code).toBe(0);
  }, 20000);
});
