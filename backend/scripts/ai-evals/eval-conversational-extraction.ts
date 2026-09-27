import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { OpenAiConversationalExtractionProvider } from '../../src/modules/profile/conversational-setup/openai-conversational-extraction.provider';
import type { ConversationalField } from '../../src/modules/profile/conversational-setup/types';
import type { AiUsageTrackerService } from '../../src/common/ai/ai-usage-tracker.service';

/**
 * Feature 21 (FR-296/FR-297): a real, runnable eval against the real OpenAI
 * account — never mocked, matching this project's standing testing
 * discipline. Fixtures are 100% synthetic, authored for this purpose, never
 * real user data (master directive's explicit prohibition).
 *
 * Run: `npx ts-node scripts/ai-evals/eval-conversational-extraction.ts`
 *
 * This is a baseline measurement tool, not a pass/fail gate — see
 * docs/ai-evaluation.md for how to read the result and when to re-run it
 * (any prompt/schema/model change to `OpenAiConversationalExtractionProvider`).
 */

interface FixtureCase {
  remainingFields: ConversationalField[];
  latestUserMessage: string;
  expectedField: ConversationalField | null;
  expectedStringValue: string | null;
}

function buildConfig(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      const value = process.env[key];
      if (value === undefined) throw new Error(`Missing env var: ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

// No DB write for an eval run — accuracy is the point, not usage accounting.
function noopUsageTracker(): AiUsageTrackerService {
  return { record: async () => undefined } as unknown as AiUsageTrackerService;
}

async function main() {
  const fixturesPath = path.join(__dirname, 'fixtures', 'conversational-extraction.json');
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8')) as FixtureCase[];

  const provider = new OpenAiConversationalExtractionProvider(
    buildConfig(),
    noopUsageTracker(),
  );

  let fieldCorrect = 0;
  let valueCorrect = 0;
  let valueApplicable = 0;
  const failures: string[] = [];

  for (const [i, fixture] of fixtures.entries()) {
    const result = await provider.extractTurn(
      [],
      fixture.remainingFields,
      fixture.latestUserMessage,
    );

    const fieldMatch = result.proposed.field === fixture.expectedField;
    if (fieldMatch) fieldCorrect++;
    else {
      failures.push(
        `#${i} field: expected ${JSON.stringify(fixture.expectedField)}, got ${JSON.stringify(result.proposed.field)} (message: "${fixture.latestUserMessage}")`,
      );
    }

    if (fixture.expectedStringValue !== null) {
      valueApplicable++;
      const valueMatch = result.proposed.stringValue === fixture.expectedStringValue;
      if (valueMatch) valueCorrect++;
      else {
        failures.push(
          `#${i} stringValue: expected "${fixture.expectedStringValue}", got ${JSON.stringify(result.proposed.stringValue)}`,
        );
      }
    }
  }

  console.log('\n=== Conversational Extraction Eval ===');
  console.log(`Field accuracy:  ${fieldCorrect}/${fixtures.length} (${((fieldCorrect / fixtures.length) * 100).toFixed(1)}%)`);
  if (valueApplicable > 0) {
    console.log(`Value accuracy:  ${valueCorrect}/${valueApplicable} (${((valueCorrect / valueApplicable) * 100).toFixed(1)}%)`);
  }
  if (failures.length > 0) {
    console.log('\nFailures (real vendor non-determinism is expected sometimes — see docs/ai-evaluation.md):');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
}

main().catch((err) => {
  console.error('Eval script crashed:', err);
  process.exit(1);
});
