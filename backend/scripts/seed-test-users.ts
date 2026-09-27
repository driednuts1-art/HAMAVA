import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { VirtualUser } from './load-test/lib/virtual-user';
import { assertSafeTarget } from './load-test/lib/target-safety-check';
import { initOpenAiCostGuard } from './load-test/lib/openai-cost-guard';

/**
 * Seeds 20 real, persistent test users into the real dev database via the
 * real API — signup (OTP mock + liveness mock), full profile, one
 * placeholder photo, and a handful of real mutual matches — so opening the
 * app has something to look at immediately, not an empty deck.
 *
 * Deliberately reuses backend/scripts/load-test/lib/virtual-user.ts's own
 * VirtualUser class (signUp(), swipe(), the new completeProfileDetailed())
 * and target-safety-check.ts/openai-cost-guard.ts, rather than
 * reimplementing the same real HTTP calls — the only real difference from
 * a load-test run is that these users are meant to persist (no cleanup.ts
 * call at the end) and use their own recognizable phone scheme
 * (`+1900555####`) instead of the load-test harness's own transient one.
 *
 * Run (from backend/, with AUTH_OTP_DEBUG_ECHO=true on the target backend
 * — the same real, existing test-only mechanism this project's whole e2e
 * suite already depends on, not a new one):
 *   npx ts-node scripts/seed-test-users.ts
 */

const BASE_URL = 'http://localhost:3000';
const DOCS_OUTPUT_PATH = path.resolve(__dirname, '../../docs/test-users.md');

type Gender = 'MALE' | 'FEMALE' | 'OTHER';
type RelationshipGoal =
  'SERIOUS' | 'CASUAL' | 'MARRIAGE_TRACK' | 'FRIENDSHIP' | 'NOT_SURE';

interface SeedProfile {
  displayName: string;
  age: number;
  gender: Gender;
  datingIntent: RelationshipGoal;
  city: string;
  bio: string;
  interests: string[];
  verify: boolean;
}

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

function pickInterests(seedIndex: number, count: number): string[] {
  const picked: string[] = [];
  for (let i = 0; i < count; i++) {
    picked.push(INTEREST_POOL[(seedIndex * 7 + i * 3) % INTEREST_POOL.length]);
  }
  return Array.from(new Set(picked));
}

const PROFILES: SeedProfile[] = [
  {
    displayName: 'Ali Rezaei',
    age: 24,
    gender: 'MALE',
    datingIntent: 'SERIOUS',
    city: 'Tehran',
    bio: 'عاشق کوهنوردی و کتاب‌های تاریخی‌ام. آخر هفته‌ها معمولاً تو طبیعتم.',
    interests: pickInterests(0, 4),
    verify: true,
  },
  {
    displayName: 'Sara Ahmadi',
    age: 28,
    gender: 'FEMALE',
    datingIntent: 'SERIOUS',
    city: 'Isfahan',
    bio: 'معمار هستم، عاشق سفر و عکاسی معماریم. دنبال یه رابطه‌ی واقعی و بلندمدت.',
    interests: pickInterests(1, 5),
    verify: true,
  },
  {
    displayName: 'Reza Mohammadi',
    age: 35,
    gender: 'MALE',
    datingIntent: 'CASUAL',
    city: 'Shiraz',
    bio: 'زندگی رو ساده می‌گیرم. عاشق موسیقی سنتی و شعر حافظم.',
    interests: pickInterests(2, 3),
    verify: false,
  },
  {
    displayName: 'Negar Hosseini',
    age: 26,
    gender: 'FEMALE',
    datingIntent: 'MARRIAGE_TRACK',
    city: 'Mashhad',
    bio: 'دنبال یه همراه واقعی برای مسیر زندگی‌ام. علاقه‌مند به آشپزی و باغبانی.',
    interests: pickInterests(3, 4),
    verify: true,
  },
  {
    displayName: 'Hossein Karimi',
    age: 41,
    gender: 'MALE',
    datingIntent: 'FRIENDSHIP',
    city: 'Tabriz',
    bio: 'مهندس نرم‌افزار، عاشق شطرنج و بازی‌های فکری. دنبال دوستای جدید.',
    interests: pickInterests(4, 3),
    verify: true,
  },
  {
    displayName: 'Maryam Sadeghi',
    age: 23,
    gender: 'FEMALE',
    datingIntent: 'NOT_SURE',
    // Relocated internationally (was کرج/Karaj) — one of 7 seed users given
    // a global city instead of a transliterated Iranian one, a deliberate
    // choice to make the seed pool visibly reflect the app's global
    // audience, not just translate existing cities in place. See
    // docs/test-users.md's "Global identity rename" section for the full
    // rationale and the complete list of which 7 moved and why.
    city: 'Toronto',
    bio: 'دانشجوی هنرم، عاشق نقاشی و تئاترم. هنوز دقیق نمی‌دونم دنبال چی‌ام ولی آماده‌ی آشنایی‌ام.',
    interests: pickInterests(5, 4),
    verify: false,
  },
  {
    displayName: 'Amir Nouri',
    age: 30,
    gender: 'MALE',
    datingIntent: 'SERIOUS',
    city: 'Ahvaz',
    bio: 'دنبال یه رابطه‌ی جدی و صادقانه‌ام. عاشق فوتبال و دویدن صبحگاهی.',
    interests: pickInterests(6, 5),
    verify: true,
  },
  {
    displayName: 'Zahra Rostami',
    age: 33,
    gender: 'FEMALE',
    datingIntent: 'CASUAL',
    city: 'Qom',
    bio: 'یوگا و مدیتیشن بخش مهمی از زندگی‌ام هستن. آدم آرومی‌ام.',
    interests: pickInterests(7, 3),
    verify: true,
  },
  {
    displayName: 'Bahram Yazdani',
    age: 45,
    gender: 'MALE',
    datingIntent: 'MARRIAGE_TRACK',
    // Relocated internationally (was کرمانشاه/Kermanshah) — see the note on
    // "Maryam Sadeghi" above.
    city: 'Berlin',
    bio: 'کارآفرینم، دنبال یه همراه واقعی برای ساختن یه زندگی مشترک.',
    interests: pickInterests(8, 4),
    verify: false,
  },
  {
    displayName: 'Leila Sharifi',
    age: 27,
    gender: 'FEMALE',
    datingIntent: 'FRIENDSHIP',
    city: 'Urmia',
    bio: 'عاشق سفر و دوچرخه‌سواری‌ام. دنبال آدمای جدید برای تجربه‌های جدید.',
    interests: pickInterests(9, 4),
    verify: true,
  },
  {
    displayName: 'Kian Moradi',
    age: 22,
    gender: 'MALE',
    datingIntent: 'NOT_SURE',
    city: 'Rasht',
    bio: 'تازه دانشگاه تموم کردم. عاشق بازی‌های ویدیویی و سینما.',
    interests: pickInterests(10, 3),
    verify: true,
  },
  {
    displayName: 'Yasaman Ghasemi',
    age: 38,
    gender: 'FEMALE',
    datingIntent: 'SERIOUS',
    // Relocated internationally (was زاهدان/Zahedan) — see the note on
    // "Maryam Sadeghi" above.
    city: 'Sydney',
    bio: 'پزشکم، وقت آزادم رو با کتاب و آشپزی پر می‌کنم. دنبال یه رابطه‌ی جدی.',
    interests: pickInterests(11, 5),
    verify: true,
  },
  {
    displayName: 'Arash Taheri',
    age: 29,
    gender: 'MALE',
    datingIntent: 'CASUAL',
    // Relocated internationally (was کرمان/Kerman) — see the note on
    // "Maryam Sadeghi" above.
    city: 'London',
    bio: 'عکاسم، عاشق طبیعت و کوهنوردی. زندگی رو با دوربین می‌بینم.',
    interests: pickInterests(12, 4),
    verify: false,
  },
  {
    displayName: 'Niloufar Azizi',
    age: 25,
    gender: 'FEMALE',
    datingIntent: 'MARRIAGE_TRACK',
    city: 'Arak',
    bio: 'معلمم، عاشق بچه‌ها و باغبانی‌ام. دنبال یه همراه برای یه زندگی آروم.',
    interests: pickInterests(13, 4),
    verify: true,
  },
  {
    displayName: 'Pouya Jafari',
    age: 31,
    gender: 'MALE',
    datingIntent: 'FRIENDSHIP',
    city: 'Yazd',
    bio: 'برنامه‌نویسم، شب‌ها شطرنج بازی می‌کنم. دنبال دوستای هم‌فکر.',
    interests: pickInterests(14, 3),
    verify: true,
  },
  {
    displayName: 'Shida Akbari',
    age: 40,
    gender: 'FEMALE',
    datingIntent: 'NOT_SURE',
    // Relocated internationally (was همدان/Hamadan) — see the note on
    // "Maryam Sadeghi" above.
    city: 'Vancouver',
    bio: 'نویسنده‌ام، عاشق موسیقی سنتی و شعرم.',
    interests: pickInterests(15, 4),
    verify: false,
  },
  {
    displayName: 'Kamran Farhadi',
    age: 36,
    gender: 'MALE',
    datingIntent: 'SERIOUS',
    city: 'Sari',
    bio: 'کشاورزم، عاشق طبیعت شمالم. دنبال یه رابطه‌ی واقعی و پایدار.',
    interests: pickInterests(16, 5),
    verify: true,
  },
  {
    displayName: 'Roya Najafi',
    age: 24,
    gender: 'FEMALE',
    datingIntent: 'CASUAL',
    // Relocated internationally (was بندرعباس/Bandar Abbas) — see the note
    // on "Maryam Sadeghi" above.
    city: 'Dubai',
    bio: 'عاشق شنا و ورزش‌های آبی‌ام. آدم پرانرژی‌ای‌ام.',
    interests: pickInterests(17, 3),
    verify: true,
  },
  {
    displayName: 'Sina Bahrami',
    age: 27,
    gender: 'OTHER',
    datingIntent: 'FRIENDSHIP',
    city: 'Qazvin',
    bio: 'هنرمندم، عاشق تئاتر و نقاشی. دنبال آدمای باز و صادق.',
    interests: pickInterests(18, 4),
    verify: true,
  },
  {
    displayName: 'Elnaz Heidari',
    age: 32,
    gender: 'OTHER',
    datingIntent: 'MARRIAGE_TRACK',
    // Relocated internationally (was زنجان/Zanjan) — see the note on
    // "Maryam Sadeghi" above.
    city: 'Los Angeles',
    bio: 'روانشناسم، عاشق مدیتیشن و یوگا. دنبال یه ارتباط عمیق و واقعی.',
    interests: pickInterests(19, 5),
    verify: false,
  },
];

// 5 real mutual-match pairs (1-indexed positions in PROFILES), leaving 10
// of the 20 users unmatched so the deck isn't empty either — a mix of
// "already matched, chat waiting" and "still browsable" on first login.
const MATCH_PAIRS: [number, number][] = [
  [1, 2],
  [3, 6],
  [7, 10],
  [11, 14],
  [17, 18],
];

function birthDateFor(age: number): string {
  const year = 2026 - age;
  return `${year}-06-15`;
}

interface SeededUser {
  profile: SeedProfile;
  phone: string;
  userId: string;
  user: VirtualUser | null;
  ok: boolean;
  error?: string;
}

async function main(): Promise<void> {
  assertSafeTarget(BASE_URL);
  initOpenAiCostGuard(200); // a real, generous-but-real safety cap for a bounded 20-user seed

  console.log(
    `Seeding ${PROFILES.length} real test users against ${BASE_URL}...`,
  );

  const seeded: SeededUser[] = [];

  for (let i = 0; i < PROFILES.length; i++) {
    const profile = PROFILES[i];
    const phone = `+1900555${String(i + 1).padStart(4, '0')}`;
    const user = new VirtualUser(BASE_URL, phone);
    try {
      await user.signUp();
      await user.completeProfileDetailed({
        displayName: profile.displayName,
        birthDate: birthDateFor(profile.age),
        gender: profile.gender,
        datingIntent: profile.datingIntent,
        city: profile.city,
        bio: profile.bio,
        interests: profile.interests,
        verify: profile.verify,
      });
      seeded.push({ profile, phone, userId: user.userId, user, ok: true });
      console.log(
        `  [${i + 1}/20] ✅ ${profile.displayName} (${phone}) — ${profile.verify ? 'verified' : 'unverified'}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      seeded.push({
        profile,
        phone,
        userId: '',
        user: null,
        ok: false,
        error: message,
      });
      console.error(
        `  [${i + 1}/20] ❌ ${profile.displayName} (${phone}) — ${message}`,
      );
    }
  }

  const successCount = seeded.filter((s) => s.ok).length;
  console.log(
    `\n${successCount}/${PROFILES.length} users created successfully.`,
  );

  console.log('\nCreating real mutual matches...');
  const matchResults: { a: string; b: string; ok: boolean; error?: string }[] =
    [];
  for (const [aIdx, bIdx] of MATCH_PAIRS) {
    const a = seeded[aIdx - 1];
    const b = seeded[bIdx - 1];
    if (!a.ok || !b.ok || !a.user || !b.user) {
      matchResults.push({
        a: a.profile.displayName,
        b: b.profile.displayName,
        ok: false,
        error: 'one or both users failed creation',
      });
      continue;
    }
    try {
      // Reuses the same already-authenticated VirtualUser instances from
      // the creation loop above — no need to re-login, their real access
      // tokens are still valid.
      const first = await a.user.swipe(b.userId, 'LIKE');
      const matched = first.body.matched
        ? true
        : (await b.user.swipe(a.userId, 'LIKE')).body.matched;
      if (!matched) throw new Error('swipe did not produce a match');
      matchResults.push({
        a: a.profile.displayName,
        b: b.profile.displayName,
        ok: true,
      });
      console.log(`  ✅ ${a.profile.displayName} <-> ${b.profile.displayName}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      matchResults.push({
        a: a.profile.displayName,
        b: b.profile.displayName,
        ok: false,
        error: message,
      });
      console.error(
        `  ❌ ${a.profile.displayName} <-> ${b.profile.displayName} — ${message}`,
      );
    }
  }
  const matchSuccessCount = matchResults.filter((m) => m.ok).length;
  console.log(
    `${matchSuccessCount}/${MATCH_PAIRS.length} matches created successfully.`,
  );

  const lines: string[] = [
    '# Test users (seeded, real dev database)',
    '',
    `Seeded ${new Date().toISOString().slice(0, 10)} via \`backend/scripts/seed-test-users.ts\` — real users, real profiles, created through the real API against the real dev database (never the load-test branch). All are re-loginable with the real mock OTP flow (\`AUTH_OTP_DEBUG_ECHO=true\` on the backend shows the code directly on the login screen, matching this project's own established dev-login convention).`,
    '',
    `**${successCount}/${PROFILES.length} users created successfully.** **${matchSuccessCount}/${MATCH_PAIRS.length} real mutual matches created.**`,
    '',
    '| # | Name | Phone | Age | Gender | Intent | City | Verified | Created |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  seeded.forEach((s, i) => {
    lines.push(
      `| ${i + 1} | ${s.profile.displayName} | \`${s.phone}\` | ${s.profile.age} | ${s.profile.gender} | ${s.profile.datingIntent} | ${s.profile.city} | ${s.profile.verify ? '✅' : '❌'} | ${s.ok ? '✅' : `❌ ${s.error}`} |`,
    );
  });
  lines.push('', '## Real matches', '');
  if (matchResults.length === 0) {
    lines.push('None.');
  } else {
    for (const m of matchResults) {
      lines.push(
        `- ${m.ok ? '✅' : '❌'} ${m.a} ↔ ${m.b}${m.ok ? '' : ` (${m.error})`}`,
      );
    }
  }
  lines.push('');

  writeFileSync(DOCS_OUTPUT_PATH, lines.join('\n'), 'utf-8');
  console.log(`\nWritten to ${DOCS_OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('\nSeed script failed:', err);
  process.exitCode = 1;
});
