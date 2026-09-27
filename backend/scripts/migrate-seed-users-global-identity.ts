import 'dotenv/config';
import { VirtualUser } from './load-test/lib/virtual-user';
import { assertSafeTarget } from './load-test/lib/target-safety-check';

/**
 * One-off, real migration (2026-09-25, docs/test-users.md "Global identity
 * rename" section): renames the 20 real, existing seed users
 * (scripts/seed-test-users.ts) from their original Persian display names
 * and Iranian cities to Latin-transliterated English names and (for 7 of
 * them) international cities, per the English/global identity pivot
 * (docs/i18n-rtl-migration-scope.md).
 *
 * Deliberately a real PATCH /v1/profile against the SAME existing account
 * (same phone, same real user id), not delete-and-recreate — this is the
 * only way to keep every real match/swipe/photo/prompt-answer these 20
 * accounts already carry intact automatically (they're all keyed by user
 * id, which never changes here). Reuses VirtualUser.signUp() exactly like
 * every other seed script in this file — a real OTP login against an
 * already-existing phone works identically to a fresh one.
 *
 * Touches ONLY displayName and city — bio/interests/age/gender/verification
 * status are explicitly out of scope for this rename (per the user's own
 * itemized request) and are left completely untouched.
 *
 * Idempotent: safe to re-run — it always PATCHes to the same target values.
 *
 * Run (from backend/, target backend already running with
 * AUTH_OTP_DEBUG_ECHO=true, same requirement as every other seed script):
 *   npx ts-node scripts/migrate-seed-users-global-identity.ts
 */

const BASE_URL = 'http://localhost:3000';

interface Rename {
  phone: string;
  oldDisplayName: string;
  newDisplayName: string;
  oldCity: string;
  newCity: string;
}

// 1-indexed to match docs/test-users.md's own `#` column and the
// `+1900555####` phone scheme seed-test-users.ts established. Cities marked
// "relocated" are the 7 deliberately moved to an international city instead
// of a transliterated Iranian one — see docs/test-users.md for the full
// rationale.
const RENAMES: Rename[] = [
  { phone: '+19005550001', oldDisplayName: 'علی رضایی', newDisplayName: 'Ali Rezaei', oldCity: 'تهران', newCity: 'Tehran' },
  { phone: '+19005550002', oldDisplayName: 'سارا احمدی', newDisplayName: 'Sara Ahmadi', oldCity: 'اصفهان', newCity: 'Isfahan' },
  { phone: '+19005550003', oldDisplayName: 'رضا محمدی', newDisplayName: 'Reza Mohammadi', oldCity: 'شیراز', newCity: 'Shiraz' },
  { phone: '+19005550004', oldDisplayName: 'نگار حسینی', newDisplayName: 'Negar Hosseini', oldCity: 'مشهد', newCity: 'Mashhad' },
  { phone: '+19005550005', oldDisplayName: 'حسین کریمی', newDisplayName: 'Hossein Karimi', oldCity: 'تبریز', newCity: 'Tabriz' },
  { phone: '+19005550006', oldDisplayName: 'مریم صادقی', newDisplayName: 'Maryam Sadeghi', oldCity: 'کرج', newCity: 'Toronto' }, // relocated
  { phone: '+19005550007', oldDisplayName: 'امیر نوری', newDisplayName: 'Amir Nouri', oldCity: 'اهواز', newCity: 'Ahvaz' },
  { phone: '+19005550008', oldDisplayName: 'زهرا رستمی', newDisplayName: 'Zahra Rostami', oldCity: 'قم', newCity: 'Qom' },
  { phone: '+19005550009', oldDisplayName: 'بهرام یزدانی', newDisplayName: 'Bahram Yazdani', oldCity: 'کرمانشاه', newCity: 'Berlin' }, // relocated
  { phone: '+19005550010', oldDisplayName: 'لیلا شریفی', newDisplayName: 'Leila Sharifi', oldCity: 'ارومیه', newCity: 'Urmia' },
  { phone: '+19005550011', oldDisplayName: 'کیان مرادی', newDisplayName: 'Kian Moradi', oldCity: 'رشت', newCity: 'Rasht' },
  { phone: '+19005550012', oldDisplayName: 'یاسمن قاسمی', newDisplayName: 'Yasaman Ghasemi', oldCity: 'زاهدان', newCity: 'Sydney' }, // relocated
  { phone: '+19005550013', oldDisplayName: 'آرش طاهری', newDisplayName: 'Arash Taheri', oldCity: 'کرمان', newCity: 'London' }, // relocated
  { phone: '+19005550014', oldDisplayName: 'نیلوفر عزیزی', newDisplayName: 'Niloufar Azizi', oldCity: 'اراک', newCity: 'Arak' },
  { phone: '+19005550015', oldDisplayName: 'پویا جعفری', newDisplayName: 'Pouya Jafari', oldCity: 'یزد', newCity: 'Yazd' },
  { phone: '+19005550016', oldDisplayName: 'شیدا اکبری', newDisplayName: 'Shida Akbari', oldCity: 'همدان', newCity: 'Vancouver' }, // relocated
  { phone: '+19005550017', oldDisplayName: 'کامران فرهادی', newDisplayName: 'Kamran Farhadi', oldCity: 'ساری', newCity: 'Sari' },
  { phone: '+19005550018', oldDisplayName: 'رویا نجفی', newDisplayName: 'Roya Najafi', oldCity: 'بندرعباس', newCity: 'Dubai' }, // relocated
  { phone: '+19005550019', oldDisplayName: 'سینا بهرامی', newDisplayName: 'Sina Bahrami', oldCity: 'قزوین', newCity: 'Qazvin' },
  { phone: '+19005550020', oldDisplayName: 'الناز حیدری', newDisplayName: 'Elnaz Heidari', oldCity: 'زنجان', newCity: 'Los Angeles' }, // relocated
];

interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

interface ProfileResponse {
  displayName: string | null;
  city: string | null;
}

async function patchProfile(
  token: string,
  displayName: string,
  city: string,
): Promise<ApiResult<ProfileResponse>> {
  const res = await fetch(`${BASE_URL}/v1/profile`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ displayName, city }),
  });
  const text = await res.text();
  const body = text
    ? (JSON.parse(text) as ProfileResponse)
    : (undefined as unknown as ProfileResponse);
  return { status: res.status, body };
}

async function getProfile(token: string): Promise<ApiResult<ProfileResponse>> {
  const res = await fetch(`${BASE_URL}/v1/profile/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  const body = text
    ? (JSON.parse(text) as ProfileResponse)
    : (undefined as unknown as ProfileResponse);
  return { status: res.status, body };
}

async function main(): Promise<void> {
  assertSafeTarget(BASE_URL);
  console.log(
    `Renaming ${RENAMES.length} real seed users to their global/English identity against ${BASE_URL}...`,
  );

  let succeeded = 0;
  const failed: string[] = [];
  const mismatched: string[] = [];

  for (const r of RENAMES) {
    try {
      const user = new VirtualUser(BASE_URL, r.phone);
      await user.signUp(); // a real login for this already-existing phone — same account, not a new one.

      // Real, direct verification BEFORE writing: confirm this account
      // really is the expected old name before renaming it — a real safety
      // check against ever silently renaming the wrong account.
      const before = await getProfile(user.token);
      if (before.body.displayName !== r.oldDisplayName) {
        throw new Error(
          `Expected displayName "${r.oldDisplayName}" before renaming, found "${before.body.displayName}" instead — refusing to touch this account.`,
        );
      }

      const result = await patchProfile(user.token, r.newDisplayName, r.newCity);
      if (result.status !== 200) {
        throw new Error(
          `PATCH /v1/profile failed: ${result.status} ${JSON.stringify(result.body)}`,
        );
      }
      if (
        result.body.displayName !== r.newDisplayName ||
        result.body.city !== r.newCity
      ) {
        mismatched.push(r.newDisplayName);
      }
      succeeded++;
      console.log(
        `  ✓ ${r.phone}: "${r.oldDisplayName}" / "${r.oldCity}" -> "${r.newDisplayName}" / "${r.newCity}"`,
      );
    } catch (err) {
      failed.push(r.newDisplayName);
      console.error(
        `  ✗ ${r.phone} (${r.oldDisplayName} -> ${r.newDisplayName}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`\nDone. Succeeded: ${succeeded}/${RENAMES.length}, failed: ${failed.length}.`);
  if (failed.length > 0) console.log('Failed:', failed);
  if (mismatched.length > 0) {
    console.log(
      'WARNING — real response did not echo back the new values for (investigate before trusting):',
      mismatched,
    );
  } else {
    console.log('Verified: every successful PATCH echoed back the exact new displayName/city.');
  }

  process.exitCode = failed.length > 0 || mismatched.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Migration script crashed:', err);
  process.exit(1);
});
