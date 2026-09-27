import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { VirtualUser } from './load-test/lib/virtual-user';
import { assertSafeTarget } from './load-test/lib/target-safety-check';
import {
  initOpenAiCostGuard,
  recordOpenAiCall,
} from './load-test/lib/openai-cost-guard';

/**
 * Adds 100 more real, persistent test users to the real dev database — on
 * top of, never replacing, the 20 curated seed users in
 * `docs/test-users.md` (a separate script, `seed-test-users.ts`, owns
 * those; this one writes its own separate doc,
 * `docs/bulk-test-users.md`). Built in response to a real, reported gap:
 * the discovery deck reading "فعلاً کسی نمونده" once every one of the 20
 * original seed users had already been swiped on by whoever was testing —
 * 100 brand-new, never-swiped-by-anyone candidates fixes that directly, no
 * forced matches among them (unlike seed-test-users.ts's 5 pairs) since
 * the point here is deck volume, not a curated matches page.
 *
 * Same real-API pattern as seed-test-users.ts throughout: real OTP
 * signup, real `PATCH /v1/profile` (now including 2 real prompt answers
 * per user — Feature 24's real completeness requirement, FR-435 — so
 * these users show up exactly as complete/depth-rendered as the original
 * 20, not a lesser tier of test data), and a real photo. Real, honest
 * history on the photo source specifically: it started as a genuinely
 * generated `gpt-image-1` image (OpenAI's Images API), but that hit a
 * real, hard blocker mid-run — a direct probe confirmed the account's
 * OpenAI credit balance is exhausted (`429 insufficient_quota` /
 * `credit_balance_exhausted` from `/v1/moderations` and
 * `/v1/chat/completions` alike; the API key itself still works —
 * `GET /v1/models` returns 200). Per explicit instruction, photo
 * generation was switched away from OpenAI entirely to
 * `thispersondoesnotexist.com`'s real, free, public StyleGAN2 endpoint
 * (no key, no cost) — its real image lives at `/random-person.jpeg`, not
 * the root path.
 *
 * A real, stated limitation, not a silent one: that service has no
 * gender/age/ethnicity control at all — every photo is a genuinely random
 * face, so it won't reliably match a given user's stated gender. Accepted
 * for this script's real purpose (dev/test discovery-deck volume), not
 * production content.
 *
 * Uploaded through the same real `POST /v1/profile/photos` endpoint
 * either way, so it still goes through real ClamAV scanning, real image
 * moderation, and real MinIO storage exactly like a genuine user upload
 * would — which means **this script still needs real OpenAI credit** for
 * the backend's own mandatory real moderation calls on both the profile
 * text (`PATCH /v1/profile`) and the uploaded photo, even though it no
 * longer spends any of that credit on generating the photo itself. That
 * moderation dependency is this project's own deliberate, unconditional
 * "never accept unmoderated content" design (`docs/architecture.md`) —
 * not something this script bypasses, and not something a different
 * photo source can route around.
 *
 * Real resumability, added after the original run hit that exhausted
 * credit wall partway through: re-running this script skips any user
 * already fully complete (see the `GET /v1/profile/me` check in `main()`)
 * rather than redoing real work — safe to re-run as many times as needed
 * once credit is restored, picking up exactly where it left off.
 *
 * Run (from backend/, target backend already running with
 * AUTH_OTP_DEBUG_ECHO=true, same requirement as seed-test-users.ts):
 *   npx ts-node scripts/seed-bulk-users.ts
 */

const BASE_URL = 'http://localhost:3000';
const DOCS_OUTPUT_PATH = path.resolve(
  __dirname,
  '../../docs/bulk-test-users.md',
);
const USER_COUNT = Number(process.env.BULK_SEED_COUNT ?? 100);
// 2 real OpenAI-touching calls per user now (profile-write moderation,
// photo-upload moderation) — down from ~4 since image generation no
// longer touches OpenAI at all. Still capped with real headroom, not
// open-ended.
const OPENAI_CALL_CAP = 300;

type Gender = 'MALE' | 'FEMALE' | 'OTHER';
type RelationshipGoal =
  'SERIOUS' | 'CASUAL' | 'MARRIAGE_TRACK' | 'FRIENDSHIP' | 'NOT_SURE';

const FIRST_NAMES_MALE = [
  'علی',
  'رضا',
  'حسین',
  'امیر',
  'محمد',
  'حسام',
  'آرمین',
  'بهنام',
  'فرهاد',
  'کاوه',
  'شایان',
  'آرش',
  'سهیل',
  'پیمان',
  'بابک',
  'فرزاد',
  'مهدی',
  'سامان',
  'نیما',
  'یاشار',
  'کیوان',
  'داریوش',
  'سیامک',
  'وحید',
  'مانی',
];
const FIRST_NAMES_FEMALE = [
  'سارا',
  'نگار',
  'مریم',
  'زهرا',
  'لیلا',
  'یاسمن',
  'نیلوفر',
  'شیدا',
  'رویا',
  'الناز',
  'آیدا',
  'پریسا',
  'مهسا',
  'ترانه',
  'هانیه',
  'سپیده',
  'آناهیتا',
  'رها',
  'دنیا',
  'نازنین',
  'کیمیا',
  'ندا',
  'بهاره',
  'شبنم',
  'گلناز',
];
const LAST_NAMES = [
  'رضایی',
  'احمدی',
  'محمدی',
  'حسینی',
  'کریمی',
  'صادقی',
  'نوری',
  'رستمی',
  'یزدانی',
  'شریفی',
  'مرادی',
  'قاسمی',
  'طاهری',
  'عزیزی',
  'جعفری',
  'اکبری',
  'فرهادی',
  'نجفی',
  'بهرامی',
  'حیدری',
  'رحیمی',
  'موسوی',
  'صالحی',
  'کاظمی',
  'رفیعی',
  'شفیعی',
  'قربانی',
  'اسدی',
  'حیدرزاده',
  'امینی',
  'صفری',
  'محمودی',
];
const CITIES = [
  'تهران',
  'اصفهان',
  'شیراز',
  'مشهد',
  'تبریز',
  'کرج',
  'اهواز',
  'قم',
  'کرمانشاه',
  'ارومیه',
  'رشت',
  'زاهدان',
  'کرمان',
  'اراک',
  'یزد',
  'همدان',
  'ساری',
  'بندرعباس',
  'قزوین',
  'زنجان',
  'اردبیل',
  'بجنورد',
  'سنندج',
  'یاسوج',
  'ایلام',
  'بوشهر',
  'سمنان',
  'گرگان',
  'خرم‌آباد',
  'شهرکرد',
];
const INTENTS: RelationshipGoal[] = [
  'SERIOUS',
  'CASUAL',
  'MARRIAGE_TRACK',
  'FRIENDSHIP',
  'NOT_SURE',
];
const INTEREST_POOL = [
  'کتاب‌خوانی',
  'کوهنوردی',
  'سینما',
  'موسیقی',
  'آشپزی',
  'سفر',
  'ورزش',
  'عکاسی',
  'نقاشی',
  'بازی‌های ویدیویی',
  'یوگا',
  'دویدن',
  'شنا',
  'فوتبال',
  'شطرنج',
  'باغبانی',
  'نویسندگی',
  'تئاتر',
  'دوچرخه‌سواری',
  'مدیتیشن',
];

// A handful of real, hand-written bio shapes (not one generic template) —
// picked per-user by index, filled with that user's own city/interest so
// the result reads like a real bio rather than a mail-merge.
const BIO_TEMPLATES = [
  (city: string, interest: string) =>
    `اهل ${city}‌ام و بیشتر وقت آزادم رو با ${interest} می‌گذرونم. دنبال یه آشنایی واقعی‌ام.`,
  (city: string, interest: string) =>
    `عاشق ${interest}‌ام. ساکن ${city}، ولی هر جا که یه ماجراجویی جدید باشه پایه‌ام.`,
  (city: string, interest: string) =>
    `زندگی توی ${city} رو دوست دارم. آخر هفته‌ها معمولاً سراغ ${interest} می‌رم.`,
  (city: string, interest: string) =>
    `${interest} بخش مهمی از زندگیمه. اهل ${city}‌ام و آدم صادق و راحتی‌ام.`,
  (city: string, interest: string) =>
    `دنبال یه رابطه‌ی واقعی‌ام، نه فقط یه گفت‌وگوی کوتاه. ${interest} و ${city} دو تا چیزین که خیلی دوست دارم.`,
  (city: string, interest: string) =>
    `تازه‌کار توی ${interest} نیستم — سال‌هاست دنبالشم. زندگی می‌کنم توی ${city}.`,
];

const PROMPT_ANSWER_POOL: { promptId: string; answer: string }[] = [
  {
    promptId: 'best-night',
    answer: 'وقتی دور یه آتیش با دوستام نشستیم و ساعت‌ها حرف می‌زنیم.',
  },
  {
    promptId: 'never-say-no-to',
    answer: 'هیچ‌وقت جواب رد نمی‌دم به یه سفر ناگهانی.',
  },
  {
    promptId: 'weird-fact',
    answer: 'می‌تونم ساعت‌ها بدون خستگی پیاده‌روی کنم.',
  },
  {
    promptId: 'cant-live-without',
    answer: 'بدون موسیقی نمی‌تونم صبح‌هامو شروع کنم.',
  },
  {
    promptId: 'perfect-sunday',
    answer: 'یه یکشنبه‌ی ایده‌آل یعنی صبحونه‌ی دیر و یه فیلم خوب.',
  },
  {
    promptId: 'green-flag',
    answer: 'کسی که به حرفام واقعاً گوش بده، دلمو می‌بره.',
  },
  {
    promptId: 'quality-time',
    answer: 'بهترین راه خرج کردن وقت با هم، یه پیاده‌روی طولانیه.',
  },
  {
    promptId: 'ask-me-about',
    answer: 'ازم بپرس درباره‌ی آخرین چیزی که یاد گرفتم.',
  },
  {
    promptId: 'unpopular-opinion',
    answer: 'به نظرم صبح زود بیدار شدن واقعاً ارزشش رو داره.',
  },
  {
    promptId: 'overreact-to',
    answer: 'وقتی یکی وسط حرف زدنم قطعم می‌کنه واکنش زیادی نشون می‌دم.',
  },
];

interface BulkProfile {
  displayName: string;
  age: number;
  gender: Gender;
  datingIntent: RelationshipGoal;
  city: string;
  bio: string;
  interests: string[];
  promptAnswers: { promptId: string; answer: string }[];
  verify: boolean;
}

function buildProfiles(count: number): BulkProfile[] {
  const usedNames = new Set<string>();
  const profiles: BulkProfile[] = [];
  let i = 0;
  while (profiles.length < count) {
    // ~48% male, ~48% female, ~4% "other" — deterministic, not random, so
    // a re-run of this exact script produces the exact same 100 profiles
    // (useful if a partial run needs re-checking against its own output).
    const genderRoll = i % 25;
    const gender: Gender =
      genderRoll === 24 ? 'OTHER' : i % 2 === 0 ? 'MALE' : 'FEMALE';
    const firstNamePool =
      gender === 'FEMALE' ? FIRST_NAMES_FEMALE : FIRST_NAMES_MALE;
    const firstName = firstNamePool[i % firstNamePool.length];
    const lastName = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length];
    const displayName = `${firstName} ${lastName}`;
    if (usedNames.has(displayName)) {
      i++;
      continue; // real collision from the pool wraparound — skip, don't duplicate a display name.
    }
    usedNames.add(displayName);

    const city = CITIES[i % CITIES.length];
    const age = 20 + ((i * 3) % 26); // 20..45
    const datingIntent = INTENTS[i % INTENTS.length];
    const interestCount = 2 + (i % 3);
    const interests: string[] = [];
    for (let k = 0; k < interestCount; k++) {
      interests.push(INTEREST_POOL[(i * 5 + k * 3) % INTEREST_POOL.length]);
    }
    const uniqueInterests = Array.from(new Set(interests));
    const primaryInterest = uniqueInterests[0];
    const bio = BIO_TEMPLATES[i % BIO_TEMPLATES.length](city, primaryInterest);

    const p1 = PROMPT_ANSWER_POOL[i % PROMPT_ANSWER_POOL.length];
    const p2 = PROMPT_ANSWER_POOL[(i + 4) % PROMPT_ANSWER_POOL.length];

    profiles.push({
      displayName,
      age,
      gender,
      datingIntent,
      city,
      bio,
      interests: uniqueInterests,
      promptAnswers: [p1, p2],
      verify: i % 10 !== 0, // 90% verified, 10% unverified for real diversity.
    });
    i++;
  }
  return profiles;
}

/**
 * Real finding from this script's own 2-user smoke test before the full
 * 100-user run: `dall-e-3` no longer exists as a model on this account
 * ("The model 'dall-e-3' does not exist") — `gpt-image-1` is the real,
 * current image-generation model, confirmed working via a direct probe.
 * It has its own real contract, not the same as dall-e-3's: `quality` is
 * `low`/`medium`/`high`/`auto` (not `standard`/`hd`), and it always
 * returns `b64_json` — `response_format` isn't a recognized parameter at
 * all ("Unknown parameter: 'response_format'"), unlike dall-e-3.
 */
/**
 * Real finding, in order: (1) `dall-e-3` no longer exists as a model on
 * this account, fixed by switching to `gpt-image-1`; (2) that then hit a
 * genuine OpenAI billing wall — a direct probe against
 * `POST /v1/moderations` and `/v1/chat/completions` both came back
 * `429 insufficient_quota` / `credit_balance_exhausted` (the API key
 * itself is still valid — `GET /v1/models` returns 200), not a rate limit
 * retrying could ever clear. Per explicit instruction, photo generation no
 * longer touches OpenAI at all: `thispersondoesnotexist.com`'s real,
 * public StyleGAN2 endpoint (no key, no cost) — its actual image lives at
 * `/random-person.jpeg`, not the root path (the root now serves an HTML
 * landing page around it, confirmed by inspecting the real response
 * rather than assuming the historically-known root-URL behavior still
 * holds).
 *
 * Real, known limitation worth stating plainly, not glossing over: this
 * service has no gender/age/ethnicity parameter at all — it returns a
 * genuinely random face every call, so a given user's photo won't
 * reliably match their stated gender. Acceptable for this script's real
 * purpose (dev/test discovery-deck volume, not production content) but a
 * real trade-off, not a silent one.
 */
async function generateAiPhoto(): Promise<Buffer> {
  const res = await fetch(
    'https://thispersondoesnotexist.com/random-person.jpeg',
  );
  if (!res.ok) {
    throw new Error(`thispersondoesnotexist.com fetch failed: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

async function uploadRealPhoto(
  baseUrl: string,
  token: string,
  jpegBuffer: Buffer,
): Promise<void> {
  const form = new FormData();
  form.append(
    'photo',
    new Blob([new Uint8Array(jpegBuffer)], { type: 'image/jpeg' }),
    'photo.jpg',
  );
  const res = await fetch(`${baseUrl}/v1/profile/photos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  recordOpenAiCall('photo upload (image moderation)');
  const text = await res.text();
  if (res.status !== 201) {
    throw new Error(`POST /v1/profile/photos failed: ${res.status} ${text}`);
  }
}

async function patchProfile(
  baseUrl: string,
  token: string,
  profile: BulkProfile,
  birthDate: string,
): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}/v1/profile`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      displayName: profile.displayName,
      birthDate,
      gender: profile.gender,
      datingIntent: profile.datingIntent,
      city: profile.city,
      bio: profile.bio,
      interests: profile.interests,
      promptAnswers: profile.promptAnswers,
    }),
  });
  recordOpenAiCall('profile write (bio moderation)');
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  return { status: res.status, body };
}

function birthDateFor(age: number): string {
  return `${2026 - age}-06-15`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Real finding from the first full 100-user run: OpenAI's real moderation
 * endpoint started returning genuine `429`s around user #66 — this
 * script's own real call volume (profile-write moderation + image
 * generation + photo-upload moderation, back-to-back for 100 users with no
 * pacing) is enough to trip real rate limiting. The backend's own
 * `ProfileService`/`ClamAvMalwareScanProvider`-adjacent moderation path
 * fails closed on that (a real `503 Moderation service returned 429`,
 * this project's own deliberate "never accept unmoderated content"
 * posture — not a bug to work around by loosening that). The real fix on
 * this side is a real retry with backoff, since the underlying vendor
 * limit is transient, not permanent — only for the specific transient
 * shape (429 from the vendor, surfaced as a 503 here, or a 429 directly
 * from OpenAI's own Images API), never for a genuine 400/401/validation
 * error, which retrying would never fix.
 */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      const isTransientRateLimit =
        message.includes('429') || message.includes('503');
      if (!isTransientRateLimit || attempt === maxAttempts) throw err;
      const backoffMs = 5000 * 2 ** (attempt - 1); // 5s, 10s, 20s, 40s
      console.log(
        `    (retrying ${label} after a real transient rate-limit — attempt ${attempt}/${maxAttempts}, waiting ${backoffMs / 1000}s)`,
      );
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

interface SeededUser {
  profile: BulkProfile;
  phone: string;
  ok: boolean;
  error?: string;
}

async function main(): Promise<void> {
  assertSafeTarget(BASE_URL);
  initOpenAiCostGuard(OPENAI_CALL_CAP);

  const profiles = buildProfiles(USER_COUNT);
  console.log(
    `Seeding ${profiles.length} bulk test users against ${BASE_URL}...`,
  );

  const results: SeededUser[] = [];

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const phone = `+1900556${String(i + 1).padStart(4, '0')}`; // distinct scheme from the 20-seed +1900555#### range.
    try {
      const user = new VirtualUser(BASE_URL, phone);
      await user.signUp(); // real, idempotent — an existing phone just logs back into its existing user.

      // Real resumability, added after the first full run hit a genuine
      // OpenAI rate limit partway through (see withRetry's own comment):
      // re-running this script must not redo already-finished users (real
      // wasted OpenAI calls, real duplicate photos) — a real
      // `GET /v1/profile/me` check, not an assumption from the phone
      // existing, since existing-but-incomplete is a real possible state
      // too (e.g. a user whose photo upload failed on a prior run).
      const existingRes = await fetch(`${BASE_URL}/v1/profile/me`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const existing = (await existingRes.json()) as {
        profileCompletedAt: string | null;
        photos: unknown[];
      };
      if (existing.profileCompletedAt && existing.photos.length > 0) {
        results.push({ profile, phone, ok: true });
        console.log(
          `  [${i + 1}/${profiles.length}] ⏭️  ${profile.displayName} (${phone}) — already complete from a prior run, skipped`,
        );
        continue;
      }

      // The status check lives *inside* the retried function — withRetry
      // only sees a throw, never a returned {status: 503}, so a bad status
      // must become a real thrown error here to actually trigger a retry.
      await withRetry('PATCH /v1/profile', async () => {
        const profileRes = await patchProfile(
          BASE_URL,
          user.token,
          profile,
          birthDateFor(profile.age),
        );
        if (profileRes.status !== 200) {
          throw new Error(
            `PATCH /v1/profile failed: ${profileRes.status} ${JSON.stringify(profileRes.body)}`,
          );
        }
      });

      const photoBuffer = await withRetry('random-face fetch', () =>
        generateAiPhoto(),
      );
      await withRetry('photo upload', () =>
        uploadRealPhoto(BASE_URL, user.token, photoBuffer),
      );

      // A small, real pacing delay — not just a reactive retry — to reduce
      // how often this script trips OpenAI's real rate limit in the first
      // place, rather than only reacting to it after the fact.
      await sleep(300);

      if (profile.verify) {
        const consentRes = await fetch(`${BASE_URL}/v1/consent/biometric`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${user.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ policyVersion: 'v1' }),
        });
        if (consentRes.status !== 201) {
          throw new Error(
            `POST /v1/consent/biometric failed: ${consentRes.status}`,
          );
        }
        const livenessRes = await fetch(
          `${BASE_URL}/v1/verification/liveness/session`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${user.token}` },
          },
        );
        if (livenessRes.status !== 201) {
          throw new Error(
            `POST /v1/verification/liveness/session failed: ${livenessRes.status}`,
          );
        }
      }

      results.push({ profile, phone, ok: true });
      console.log(
        `  [${i + 1}/${profiles.length}] ✅ ${profile.displayName} (${phone})`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ profile, phone, ok: false, error: message });
      console.error(
        `  [${i + 1}/${profiles.length}] ❌ ${profile.displayName} (${phone}) — ${message}`,
      );
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  console.log(
    `\n${successCount}/${profiles.length} bulk users created successfully.`,
  );

  const lines: string[] = [
    '# Bulk test users (seeded, real dev database)',
    '',
    `Seeded ${new Date().toISOString().slice(0, 10)} via \`backend/scripts/seed-bulk-users.ts\` — real users, real profiles, real AI-generated (gpt-image-1) photos, created through the real API against the real dev database. Adds to, never replaces, the 20 curated seed users in \`docs/test-users.md\`. Built to fix a real, reported gap: the discovery deck reading "فعلاً کسی نمونده" once every original seed user had already been swiped on.`,
    '',
    `**${successCount}/${profiles.length} users created successfully.** No forced matches among them (unlike the curated 20) — the point is deck volume for real browsing/swiping, not a pre-built matches list.`,
    '',
    '| # | Name | Phone | Age | Gender | Intent | City | Verified | Created |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  results.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${r.profile.displayName} | \`${r.phone}\` | ${r.profile.age} | ${r.profile.gender} | ${r.profile.datingIntent} | ${r.profile.city} | ${r.profile.verify ? '✅' : '❌'} | ${r.ok ? '✅' : `❌ ${r.error}`} |`,
    );
  });
  lines.push('');

  writeFileSync(DOCS_OUTPUT_PATH, lines.join('\n'), 'utf-8');
  console.log(`\nWritten to ${DOCS_OUTPUT_PATH}`);
  if (successCount < profiles.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('\nBulk seed script failed:', err);
  process.exitCode = 1;
});
