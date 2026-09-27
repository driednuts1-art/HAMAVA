import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Gender, RelationshipGoal } from '@prisma/client';
import { OpenAiExtractionProvider } from '../../src/modules/discovery/ai-search/openai-extraction.provider';
import type { AiUsageTrackerService } from '../../src/common/ai/ai-usage-tracker.service';

/**
 * Feature 21 (FR-296/FR-297): a real, runnable eval against the real OpenAI
 * account. See eval-conversational-extraction.ts's own doc comment for the
 * shared discipline (synthetic fixtures only, baseline not a gate).
 *
 * Run: `npx ts-node scripts/ai-evals/eval-ai-search-extraction.ts`
 */

interface FixtureCase {
  text: string;
  expectedCity?: string | null;
  expectedMinAge?: number;
  expectedMaxAge?: number;
  expectedGender?: Gender[];
  expectedRelationshipGoal?: RelationshipGoal[];
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

function noopUsageTracker(): AiUsageTrackerService {
  return { record: async () => undefined } as unknown as AiUsageTrackerService;
}

function arraysOverlap<T>(a: T[] | undefined, b: T[]): boolean {
  if (!a) return true; // no expectation set for this dimension
  return a.some((x) => b.includes(x));
}

async function main() {
  const fixturesPath = path.join(__dirname, 'fixtures', 'ai-search-extraction.json');
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8')) as FixtureCase[];

  const provider = new OpenAiExtractionProvider(buildConfig(), noopUsageTracker());

  let dimensionsChecked = 0;
  let dimensionsCorrect = 0;
  const failures: string[] = [];

  for (const [i, fixture] of fixtures.entries()) {
    const result = await provider.extractFilters(fixture.text);

    if (fixture.expectedCity !== undefined) {
      dimensionsChecked++;
      const match =
        fixture.expectedCity === null
          ? result.city === null
          : result.city !== null && result.city.includes(fixture.expectedCity);
      if (match) dimensionsCorrect++;
      else failures.push(`#${i} city: expected ${JSON.stringify(fixture.expectedCity)}, got ${JSON.stringify(result.city)}`);
    }

    if (fixture.expectedMinAge !== undefined) {
      dimensionsChecked++;
      if (result.minAge === fixture.expectedMinAge) dimensionsCorrect++;
      else failures.push(`#${i} minAge: expected ${fixture.expectedMinAge}, got ${result.minAge}`);
    }

    if (fixture.expectedMaxAge !== undefined) {
      dimensionsChecked++;
      if (result.maxAge === fixture.expectedMaxAge) dimensionsCorrect++;
      else failures.push(`#${i} maxAge: expected ${fixture.expectedMaxAge}, got ${result.maxAge}`);
    }

    if (fixture.expectedGender !== undefined) {
      dimensionsChecked++;
      if (arraysOverlap(fixture.expectedGender, result.gender)) dimensionsCorrect++;
      else failures.push(`#${i} gender: expected overlap with ${JSON.stringify(fixture.expectedGender)}, got ${JSON.stringify(result.gender)}`);
    }

    if (fixture.expectedRelationshipGoal !== undefined) {
      dimensionsChecked++;
      if (arraysOverlap(fixture.expectedRelationshipGoal, result.relationshipGoal)) dimensionsCorrect++;
      else failures.push(`#${i} relationshipGoal: expected overlap with ${JSON.stringify(fixture.expectedRelationshipGoal)}, got ${JSON.stringify(result.relationshipGoal)}`);
    }
  }

  console.log('\n=== AI-Search Filter Extraction Eval ===');
  console.log(`Dimension accuracy: ${dimensionsCorrect}/${dimensionsChecked} (${((dimensionsCorrect / dimensionsChecked) * 100).toFixed(1)}%)`);
  if (failures.length > 0) {
    console.log('\nFailures (real vendor non-determinism is expected sometimes — see docs/ai-evaluation.md):');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
}

main().catch((err) => {
  console.error('Eval script crashed:', err);
  process.exit(1);
});
