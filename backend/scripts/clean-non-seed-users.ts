import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Dev-database hygiene (docs/roadmap.md "Dev database hygiene") — every e2e
 * run leaves real, API-created users behind (expected, not a bug: FR-driven
 * assertions need real accounts). `docs/test-users.md`'s "Pre-deploy cleanup
 * (2026-09-06)" and "Post-final-regression cleanup (2026-09-07)" sections
 * both did this exact cleanup as an ad hoc inline `node -e` one-liner, and
 * both times hit the same real Prisma gap:
 * `deleteMany({ where: { displayName: { notIn: seedNames } } })` never
 * matches a row with `displayName: null` — SQL `NOT IN` against NULL is
 * neither true nor false — silently leaving every incomplete e2e signup
 * (many tests fail/stop before ever setting a display name) behind, and
 * needing a second, manual `displayName: null` pass to actually reach the
 * real 20-seed-user state. Two occurrences of the same manual workaround is
 * a real, recurring cost, not a one-off — promoted to a permanent script
 * that gets it right in a single query every time, via an explicit `OR`
 * (which does not share `NOT IN`'s NULL blind spot), so there is no second
 * manual step to forget.
 *
 * Defaults to a dry run (reports counts, deletes nothing) — pass --confirm
 * to actually delete. Refuses to run against anything that doesn't look
 * like this project's own Neon dev database (see assertSafeDatabase below),
 * mirroring load-test/lib/target-safety-check.ts's own "refuse to run
 * unsafely" posture for a tool that, unlike that one, bypasses the API
 * entirely and deletes directly via Postgres.
 *
 * Run (from backend/):
 *   npx ts-node scripts/clean-non-seed-users.ts            # dry run
 *   npx ts-node scripts/clean-non-seed-users.ts --confirm  # actually deletes
 */

// The 20 real seed users (docs/test-users.md) — same list `seed-test-users.ts`
// and `backfill-seed-prompts.ts` each already carry their own copy of; kept
// as a plain local literal here too, matching this project's existing
// per-script convention (each script's list is small, stable, and easier to
// read as a flat literal than to couple scripts together over an import).
// English/global identity rename, 2026-09-25 (docs/test-users.md "Global
// identity rename" section) — these are the SAME 20 real accounts,
// same ids, same phone numbers, same real matches, just renamed via a real
// PATCH /v1/profile, not deleted/recreated. This list MUST track whatever
// the real, current displayName actually is in the database — a stale
// entry here would make this script think a real seed account is
// non-seed and delete it on the next --confirm run.
const SEED_DISPLAY_NAMES = [
  'Ali Rezaei',
  'Sara Ahmadi',
  'Reza Mohammadi',
  'Negar Hosseini',
  'Hossein Karimi',
  'Maryam Sadeghi',
  'Amir Nouri',
  'Zahra Rostami',
  'Bahram Yazdani',
  'Leila Sharifi',
  'Kian Moradi',
  'Yasaman Ghasemi',
  'Arash Taheri',
  'Niloufar Azizi',
  'Pouya Jafari',
  'Shida Akbari',
  'Kamran Farhadi',
  'Roya Najafi',
  'Sina Bahrami',
  'Elnaz Heidari',
];

/**
 * Mirrors assertSafeTarget's refuse-to-run-unsafely posture for a script
 * that talks to Postgres directly rather than through the API's own
 * ProductionSafetyService gate. Checked against the real, known dev
 * connection string shape (Neon), not against a hardcoded exact URL, since
 * the pooled endpoint's host can legitimately change.
 */
function assertSafeDatabase(databaseUrl: string): void {
  const looksLikeThisProjectsNeonDev =
    databaseUrl.includes('neon.tech') && databaseUrl.includes('/neondb');
  if (!looksLikeThisProjectsNeonDev) {
    throw new Error(
      `Refusing to run — DATABASE_URL doesn't look like this project's known Neon dev database ("${databaseUrl.replace(/:[^:@]+@/, ':***@')}"). ` +
        'This script runs a real, destructive deleteMany() and must never run against an unrecognized target. ' +
        'If a new legitimate target genuinely needs adding (e.g. a dedicated Neon branch), update this check explicitly, with real review.',
    );
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set — check backend/.env.');
  }
  assertSafeDatabase(databaseUrl);

  const confirm = process.argv.includes('--confirm');

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  // One query, correct for both cases — `notIn` for real (non-null)
  // non-seed names, explicit `displayName: null` for incomplete signups,
  // joined with OR so neither half depends on the other's semantics.
  const nonSeedFilter: Prisma.UserWhereInput = {
    OR: [{ displayName: { notIn: SEED_DISPLAY_NAMES } }, { displayName: null }],
  };

  const totalBefore = await prisma.user.count();
  const nonSeedCount = await prisma.user.count({ where: nonSeedFilter });
  const seedCount = await prisma.user.count({
    where: { displayName: { in: SEED_DISPLAY_NAMES } },
  });

  console.log(`Total users: ${totalBefore}`);
  console.log(
    `Seed users found: ${seedCount} (expected ${SEED_DISPLAY_NAMES.length})`,
  );
  console.log(`Non-seed users to delete: ${nonSeedCount}`);

  if (!confirm) {
    console.log(
      '\nDry run only — no rows deleted. Re-run with --confirm to actually delete.',
    );
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.user.deleteMany({ where: nonSeedFilter });

  const totalAfter = await prisma.user.count();
  const seedAfter = await prisma.user.count({
    where: { displayName: { in: SEED_DISPLAY_NAMES } },
  });

  console.log(`\nDeleted: ${result.count}`);
  console.log(
    `Remaining total: ${totalAfter} (expected ${SEED_DISPLAY_NAMES.length})`,
  );
  console.log(
    `Remaining seed users: ${seedAfter} (expected ${SEED_DISPLAY_NAMES.length})`,
  );

  if (
    totalAfter !== SEED_DISPLAY_NAMES.length ||
    seedAfter !== SEED_DISPLAY_NAMES.length
  ) {
    console.error(
      'WARNING: final counts do not match the expected 20 seed users — investigate before trusting this cleanup (do not assume it is fine).',
    );
    process.exitCode = 1;
  } else {
    console.log(
      'Verified: exactly the 20 known seed users remain, nothing else.',
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Cleanup script crashed:', err);
  process.exit(1);
});
