import { Logger } from '@nestjs/common';

export interface GracefulShutdownOptions {
  /** Fail-safe ceiling — force exit if onShutdown() hasn't resolved by then. */
  timeoutMs: number;
  /** The actual cleanup work (closing DB/Redis/the HTTP server, etc.). */
  onShutdown: () => Promise<void>;
  logger?: Logger;
  /** Overridable for testing — defaults to the real process.exit. */
  exit?: (code: number) => void;
}

/**
 * Registers SIGTERM/SIGINT handlers that run `onShutdown()` with a fail-safe
 * timeout (docs/architecture.md §5.3): if cleanup hangs (e.g. a network
 * issue mid-close), force exit anyway rather than leaving an unkillable
 * process — the exact failure mode this exists to prevent from recurring.
 *
 * Extracted out of main.ts so this logic has exactly one implementation,
 * exercised directly (not re-typed) by both `graceful-shutdown.spec.ts`
 * (the timeout-race logic, platform-independent) and
 * `scripts/graceful-shutdown-probe.ts` (real cross-process signal delivery,
 * POSIX-only — see `test/graceful-shutdown-signal.e2e-spec.ts`).
 */
export function registerGracefulShutdown(
  options: GracefulShutdownOptions,
): void {
  const logger = options.logger ?? new Logger('Shutdown');
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return; // SIGTERM and SIGINT can both arrive; only run this once.
    shuttingDown = true;
    logger.log(`Received ${signal}, shutting down gracefully...`);

    let timedOut = false;
    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, options.timeoutMs).unref();
    });

    await Promise.race([options.onShutdown(), timeout]);

    if (timedOut) {
      logger.warn(
        `Graceful shutdown did not finish within ${options.timeoutMs}ms — forcing exit rather than hanging.`,
      );
    } else {
      logger.log('Shut down cleanly.');
    }
    exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
