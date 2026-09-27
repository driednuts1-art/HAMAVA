/**
 * docs/load-testing.md's "Metrics captured per run" — per-stage p50/p95/p99
 * latency and error counts, printed at the end of every ramp step. A real
 * 4xx from a real, working rate limit is expected, correct behavior (not an
 * "error" for this tool's purposes); only 5xx and genuinely unexpected 4xx
 * get flagged. Callers decide which is which via `expected4xx`.
 */

interface StageData {
  latenciesMs: number[];
  serverErrors: Map<string, number>; // 5xx
  unexpectedClientErrors: Map<string, number>; // 4xx not in the caller's expected set
  expectedClientErrors: number; // 4xx the caller flagged as expected (rate limits etc.)
}

export class MetricsCollector {
  private stages = new Map<string, StageData>();

  private stage(name: string): StageData {
    let s = this.stages.get(name);
    if (!s) {
      s = {
        latenciesMs: [],
        serverErrors: new Map(),
        unexpectedClientErrors: new Map(),
        expectedClientErrors: 0,
      };
      this.stages.set(name, s);
    }
    return s;
  }

  /** Wraps a real HTTP call, timing it and classifying the outcome. `fn`
   * should return `{status, body}` (or throw for a genuine network
   * failure). `expected4xxStatuses` are status codes this specific call is
   * allowed to return under real load without counting as a problem
   * (e.g. 429 from a real, working per-user rate limit). */
  async time<T extends { status: number }>(
    stageName: string,
    fn: () => Promise<T>,
    expected4xxStatuses: number[] = [],
  ): Promise<T> {
    const start = Date.now();
    const stageData = this.stage(stageName);
    try {
      const result = await fn();
      stageData.latenciesMs.push(Date.now() - start);
      if (result.status >= 500) {
        const key = `HTTP ${result.status}`;
        stageData.serverErrors.set(
          key,
          (stageData.serverErrors.get(key) ?? 0) + 1,
        );
      } else if (result.status >= 400) {
        if (expected4xxStatuses.includes(result.status)) {
          stageData.expectedClientErrors += 1;
        } else {
          const key = `HTTP ${result.status}`;
          stageData.unexpectedClientErrors.set(
            key,
            (stageData.unexpectedClientErrors.get(key) ?? 0) + 1,
          );
        }
      }
      return result;
    } catch (err) {
      stageData.latenciesMs.push(Date.now() - start);
      const key = `network/throw: ${err instanceof Error ? err.message : String(err)}`;
      stageData.serverErrors.set(
        key,
        (stageData.serverErrors.get(key) ?? 0) + 1,
      );
      throw err;
    }
  }

  /** For latencies measured outside a simple await'd call (e.g. real
   * WebSocket push delivery, where the "call" is an event listener, not a
   * request/response pair `time()` can wrap directly). `status` follows the
   * same 2xx/4xx/5xx classification `time()` uses — pass 504 for a real
   * timeout (never delivered within the wait window). */
  recordLatency(stageName: string, latencyMs: number, status: number): void {
    const stageData = this.stage(stageName);
    stageData.latenciesMs.push(latencyMs);
    if (status >= 500) {
      const key = `HTTP ${status}`;
      stageData.serverErrors.set(
        key,
        (stageData.serverErrors.get(key) ?? 0) + 1,
      );
    } else if (status >= 400) {
      const key = `HTTP ${status}`;
      stageData.unexpectedClientErrors.set(
        key,
        (stageData.unexpectedClientErrors.get(key) ?? 0) + 1,
      );
    }
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return sorted[idx];
  }

  printSummary(title: string): void {
    console.log(`\n=== ${title} ===`);
    for (const [name, data] of this.stages) {
      const sorted = [...data.latenciesMs].sort((a, b) => a - b);
      const totalServerErrors = [...data.serverErrors.values()].reduce(
        (a, b) => a + b,
        0,
      );
      const totalUnexpectedClientErrors = [
        ...data.unexpectedClientErrors.values(),
      ].reduce((a, b) => a + b, 0);

      console.log(
        `  ${name}: n=${sorted.length} p50=${this.percentile(sorted, 0.5)}ms ` +
          `p95=${this.percentile(sorted, 0.95)}ms p99=${this.percentile(sorted, 0.99)}ms ` +
          `real-errors=${totalServerErrors} unexpected-4xx=${totalUnexpectedClientErrors} ` +
          `expected-4xx(rate-limited etc.)=${data.expectedClientErrors}`,
      );
      for (const [msg, n] of data.serverErrors) {
        console.log(`      [${n}x REAL ERROR] ${msg}`);
      }
      for (const [msg, n] of data.unexpectedClientErrors) {
        console.log(`      [${n}x unexpected] ${msg}`);
      }
    }
  }

  hasAnyRealError(): boolean {
    for (const data of this.stages.values()) {
      if (data.serverErrors.size > 0) return true;
    }
    return false;
  }

  reset(): void {
    this.stages.clear();
  }
}
