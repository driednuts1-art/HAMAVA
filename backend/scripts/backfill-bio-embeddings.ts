import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '@prisma/client';
import { OpenAiEmbeddingProvider } from '../src/common/ai/openai-embedding.provider';
import { AiUsageTrackerService } from '../src/common/ai/ai-usage-tracker.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * One-time backfill for `User.bioEmbedding` (docs/requirements.md Feature 9,
 * Open Items #3): every existing user with a `bio` predates this feature,
 * so without this script they'd sit in AI Prompt Search's unranked tail
 * (FR-112) forever, instead of actually ranking the way a newly-active user
 * eventually will once they save/edit their bio again. Run once after
 * deploying this feature: `npx ts-node scripts/backfill-bio-embeddings.ts`.
 *
 * Safe to re-run: only ever touches rows where `bioEmbedding IS NULL`, so a
 * partial/interrupted run can simply be re-run to pick up where it left off.
 */
async function main() {
  const config = {
    getOrThrow: (key: string) => {
      const value = process.env[key];
      if (value === undefined) throw new Error(`Missing env var: ${key}`);
      return value;
    },
  } as unknown as ConfigService;

  const adapter = new PrismaPg({
    connectionString: config.getOrThrow<string>('DATABASE_URL'),
  });
  const prisma = new PrismaClient({ adapter });
  const usageTracker = new AiUsageTrackerService(
    prisma as unknown as PrismaService,
  );
  const embeddingProvider = new OpenAiEmbeddingProvider(config, usageTracker);

  // `bioEmbedding` is an Unsupported("vector") field — not filterable through
  // Prisma's normal query builder at all, so the NULL-check has to be raw
  // SQL; everything else about the candidate stays a plain, safe read.
  const nullEmbeddingIds = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM users
    WHERE "bioEmbedding" IS NULL
      AND (bio IS NOT NULL OR array_length(interests, 1) > 0)
  `);
  const candidates = await prisma.user.findMany({
    where: { id: { in: nullEmbeddingIds.map((r) => r.id) } },
    select: { id: true, bio: true, interests: true },
  });

  console.log(`Found ${candidates.length} user(s) to backfill.`);

  let succeeded = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const user of candidates) {
    const text = [user.bio ?? '', user.interests.join('، ')]
      .filter((part) => part.length > 0)
      .join('\n');

    if (text.length === 0) {
      skipped++; // Defensive: the OR filter above should already exclude these.
      continue;
    }

    try {
      const embedding = await embeddingProvider.embed(text);
      const vectorLiteral = `[${embedding.join(',')}]`;
      await prisma.$executeRaw(
        Prisma.sql`UPDATE users SET "bioEmbedding" = ${vectorLiteral}::vector WHERE id = ${user.id}`,
      );
      succeeded++;
    } catch (err) {
      failed.push(user.id);
      console.error(
        `Failed to embed user ${user.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(
    `Done. Succeeded: ${succeeded}, skipped (no text): ${skipped}, failed: ${failed.length}.`,
  );
  if (failed.length > 0) {
    console.log('Failed user ids (re-run this script to retry them):', failed);
  }

  await prisma.$disconnect();
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Backfill script crashed:', err);
  process.exit(1);
});
