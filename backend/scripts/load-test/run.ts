import 'dotenv/config';
import { assertSafeTarget } from './lib/target-safety-check';
import {
  initOpenAiCostGuard,
  getOpenAiCallCount,
  OpenAiCallLimitExceededError,
} from './lib/openai-cost-guard';
import { getTotalCleanupFailures } from './lib/cleanup';
import { runCoreUserJourney } from './scenarios/core-user-journey';
import { runAiFanoutResilience } from './scenarios/ai-fanout-resilience';
import { runKillSwitchToggle } from './scenarios/kill-switch-toggle';

/**
 * docs/load-testing.md — CLI entry point.
 *
 * Usage (from backend/):
 *   npx ts-node scripts/load-test/run.ts --scenario=core --max-openai-calls=500
 *   npx ts-node scripts/load-test/run.ts --scenario=ai-fanout --max-openai-calls=500
 *   npx ts-node scripts/load-test/run.ts --scenario=kill-switch --phase=before
 *   npx ts-node scripts/load-test/run.ts --scenario=kill-switch --phase=after
 *
 * The target backend must already be running with AUTH_OTP_DEBUG_ECHO=true
 * and OTP_RATE_LIMIT_BYPASS=true (`npm run start:frontend-e2e` — the exact
 * same command this project's own e2e/frontend-e2e work already uses, not
 * a new mechanism) — this tool creates many real users from one machine's
 * IP and needs both the same way every existing e2e suite does.
 */

interface Args {
  scenario: 'core' | 'ai-fanout' | 'kill-switch';
  baseUrl: string;
  maxOpenAiCalls: number | null;
  phase: 'before' | 'after' | null;
}

function parseArgs(): Args {
  const raw = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (match) raw.set(match[1], match[2]);
  }

  const scenario = raw.get('scenario');
  if (
    scenario !== 'core' &&
    scenario !== 'ai-fanout' &&
    scenario !== 'kill-switch'
  ) {
    throw new Error('Required: --scenario=core|ai-fanout|kill-switch');
  }

  const baseUrl = raw.get('base-url') ?? 'http://localhost:3000';

  const maxOpenAiCallsRaw = raw.get('max-openai-calls');
  const maxOpenAiCalls = maxOpenAiCallsRaw ? Number(maxOpenAiCallsRaw) : null;

  const phaseRaw = raw.get('phase');
  if (
    scenario === 'kill-switch' &&
    phaseRaw !== 'before' &&
    phaseRaw !== 'after'
  ) {
    throw new Error(
      '--scenario=kill-switch requires --phase=before or --phase=after',
    );
  }
  const phase = phaseRaw === 'before' || phaseRaw === 'after' ? phaseRaw : null;

  if (scenario !== 'kill-switch' && maxOpenAiCalls === null) {
    throw new Error(
      '--max-openai-calls is required for this scenario — no silent default (docs/load-testing.md).',
    );
  }

  return { scenario, baseUrl, maxOpenAiCalls, phase };
}

async function main(): Promise<void> {
  const args = parseArgs();
  assertSafeTarget(args.baseUrl);

  // The kill-switch scenario runs a handful of real users, not a ramp — a
  // real but modest cap covers it without needing its own CLI argument.
  initOpenAiCostGuard(
    args.scenario === 'kill-switch' ? 50 : args.maxOpenAiCalls!,
  );

  console.log(
    `Load test starting — scenario="${args.scenario}" target="${args.baseUrl}"`,
  );

  try {
    if (args.scenario === 'core') {
      await runCoreUserJourney(args.baseUrl);
    } else if (args.scenario === 'ai-fanout') {
      await runAiFanoutResilience(args.baseUrl);
    } else {
      await runKillSwitchToggle(args.baseUrl, args.phase!);
    }

    console.log(
      `\nDone. Total real OpenAI-touching calls this run: ${getOpenAiCallCount()}.`,
    );

    // A final, unmissable reminder if cleanup.ts's own per-stage banners
    // (which can scroll away under later stages' output) didn't already
    // get acted on — the very last thing this process prints, and a
    // non-zero exit code, so this is never silently missed.
    const cleanupFailures = getTotalCleanupFailures();
    if (cleanupFailures > 0) {
      console.error(
        `\n!! ${cleanupFailures} real user(s) across this run were NOT cleaned up automatically — ` +
          'manual SQL cleanup against the load-test branch is required (see the banner(s) above). !!',
      );
      process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof OpenAiCallLimitExceededError) {
      console.error(`\n${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error('\nLoad test failed:', err);
  process.exitCode = 1;
});
