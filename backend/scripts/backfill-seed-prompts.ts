import 'dotenv/config';
import { VirtualUser } from './load-test/lib/virtual-user';
import { assertSafeTarget } from './load-test/lib/target-safety-check';

/**
 * Feature 24 §10 #4 (docs/requirements.md): a real, explicit user decision —
 * backfill, not grandfather. Every one of the 20 real seed users
 * (docs/test-users.md) predates the FR-435 "2 real prompt answers" gate;
 * without this, they'd otherwise still show `profileCompletedAt` set (that
 * gate never re-evaluates an already-complete profile — see
 * profile.service.ts's `maybeMarkProfileCompleted`), but with an empty,
 * decorative prompt section — a real content gap for anyone using these
 * accounts to try Feature 24 manually. Two answers per user, each written by
 * hand against that person's own real bio/city/interests in
 * scripts/seed-test-users.ts, not generic filler.
 *
 * Same real-API pattern as seed-test-users.ts: a real login (`VirtualUser`'s
 * signUp() reuses the real OTP request/verify flow, which works for an
 * existing phone exactly like a fresh one) then a real `PATCH /v1/profile`
 * — never a direct DB write. Idempotent: safe to re-run, it always
 * overwrites with the same real 2 answers (uniform behavior — Feature 24
 * §10 #4's own explicit "uniform, not grandfathered" reasoning).
 *
 * Run (from backend/, target backend already running with
 * AUTH_OTP_DEBUG_ECHO=true, same requirement as seed-test-users.ts):
 *   npx ts-node scripts/backfill-seed-prompts.ts
 */

const BASE_URL = 'http://localhost:3000';

interface PromptAnswer {
  promptId: string;
  answer: string;
}

// 1-indexed to match docs/test-users.md's own `#` column and the
// `+1900555####` phone scheme seed-test-users.ts established.
const BACKFILL: { displayName: string; promptAnswers: PromptAnswer[] }[] = [
  {
    displayName: 'Ali Rezaei',
    promptAnswers: [
      {
        promptId: 'best-night',
        answer:
          'وقتی دور آتیش کنار دوستام از یه کوهنوردی سخت برگشتیم و داریم خاطره تعریف می‌کنیم.',
      },
      {
        promptId: 'cant-live-without',
        answer: 'بدون یه کتاب تاریخی خوب کنار دستم نمی‌تونم بخوابم.',
      },
    ],
  },
  {
    displayName: 'Sara Ahmadi',
    promptAnswers: [
      {
        promptId: 'perfect-sunday',
        answer:
          'یه یکشنبه‌ی ایده‌آل یعنی گشت‌وگذار توی یه شهر قدیمی با دوربینم.',
      },
      {
        promptId: 'quality-time',
        answer: 'بهترین راه گذروندن وقت با هم، کاوش توی معماری یه شهر جدیده.',
      },
    ],
  },
  {
    displayName: 'Reza Mohammadi',
    promptAnswers: [
      {
        promptId: 'green-flag',
        answer: 'کسی که شعر حافظ رو بلد باشه بخونه، دلمو می‌بره.',
      },
      {
        promptId: 'ask-me-about',
        answer: 'ازم بپرس درباره‌ی بهترین غزل حافظ که تا حالا خوندم.',
      },
    ],
  },
  {
    displayName: 'Negar Hosseini',
    promptAnswers: [
      {
        promptId: 'never-say-no-to',
        answer: 'هیچ‌وقت جواب رد نمی‌دم به یه بشقاب غذای خونگی تازه.',
      },
      {
        promptId: 'perfect-sunday',
        answer: 'یه یکشنبه‌ی ایده‌آل یعنی صبح تو باغچه و ظهر پای اجاق.',
      },
    ],
  },
  {
    displayName: 'Hossein Karimi',
    promptAnswers: [
      {
        promptId: 'unpopular-opinion',
        answer: 'به نظرم شطرنج از خیلی بازی‌های ویدیویی جذاب‌تره.',
      },
      {
        promptId: 'quality-time',
        answer: 'بهترین راه خرج کردن وقت با هم، یه بازی شطرنج آرومه.',
      },
    ],
  },
  {
    displayName: 'Maryam Sadeghi',
    promptAnswers: [
      {
        promptId: 'weird-fact',
        answer: 'می‌تونم ساعت‌ها فقط نقاشی کنم و وقت از دستم در بره.',
      },
      {
        promptId: 'ask-me-about',
        answer: 'ازم بپرس درباره‌ی آخرین نمایشی که بازی کردم.',
      },
    ],
  },
  {
    displayName: 'Amir Nouri',
    promptAnswers: [
      {
        promptId: 'best-night',
        answer: 'بهترین شبم بعد از یه بازی فوتبال خوب با رفیقامه.',
      },
      {
        promptId: 'never-say-no-to',
        answer: 'هیچ‌وقت جواب رد نمی‌دم به یه دوی صبحگاهی.',
      },
    ],
  },
  {
    displayName: 'Zahra Rostami',
    promptAnswers: [
      {
        promptId: 'perfect-sunday',
        answer: 'یه یکشنبه‌ی ایده‌آل با یه کلاس یوگا شروع می‌شه.',
      },
      {
        promptId: 'cant-live-without',
        answer: 'بدون مدیتیشن روزانه نمی‌تونم آروم بمونم.',
      },
    ],
  },
  {
    displayName: 'Bahram Yazdani',
    promptAnswers: [
      {
        promptId: 'green-flag',
        answer: 'آدمی که برای رسیدن به هدفش صبور باشه، برام جذابه.',
      },
      {
        promptId: 'quality-time',
        answer: 'بهترین راه خرج کردن وقت با هم، حرف زدن درباره‌ی رویاهامونه.',
      },
    ],
  },
  {
    displayName: 'Leila Sharifi',
    promptAnswers: [
      {
        promptId: 'best-night',
        answer: 'بهترین شبم وقتیه که چادر می‌زنیم و زیر ستاره‌ها می‌خوابیم.',
      },
      {
        promptId: 'unpopular-opinion',
        answer: 'به نظرم دوچرخه بهتر از ماشینه، حتی تو شهرای شلوغ.',
      },
    ],
  },
  {
    displayName: 'Kian Moradi',
    promptAnswers: [
      {
        promptId: 'weird-fact',
        answer: 'یه بازی رو تا صبح انجام دادم چون نمی‌تونستم تمومش نکنم.',
      },
      {
        promptId: 'ask-me-about',
        answer: 'ازم بپرس درباره‌ی آخرین فیلمی که دیدم.',
      },
    ],
  },
  {
    displayName: 'Yasaman Ghasemi',
    promptAnswers: [
      {
        promptId: 'never-say-no-to',
        answer: 'هیچ‌وقت جواب رد نمی‌دم به یه کتاب خوب با یه چای داغ.',
      },
      {
        promptId: 'perfect-sunday',
        answer: 'یه یکشنبه‌ی ایده‌آل یعنی آشپزی و بعدش کتاب‌خوانی.',
      },
    ],
  },
  {
    displayName: 'Arash Taheri',
    promptAnswers: [
      {
        promptId: 'cant-live-without',
        answer: 'بدون دوربینم حس می‌کنم یه چیزی کمه.',
      },
      {
        promptId: 'best-night',
        answer: 'بهترین شبم وقتیه که بالای یه قله غروب رو عکس می‌گیرم.',
      },
    ],
  },
  {
    displayName: 'Niloufar Azizi',
    promptAnswers: [
      {
        promptId: 'green-flag',
        answer: 'کسی که با بچه‌ها مهربون باشه، فوراً دلمو می‌بره.',
      },
      {
        promptId: 'quality-time',
        answer: 'بهترین راه خرج کردن وقت با هم، کاشتن یه گل جدید تو باغچه‌ست.',
      },
    ],
  },
  {
    displayName: 'Pouya Jafari',
    promptAnswers: [
      {
        promptId: 'unpopular-opinion',
        answer: 'به نظرم دیباگ کردن یه کد سخت، مثل حل یه پازل شطرنجه.',
      },
      {
        promptId: 'ask-me-about',
        answer: 'ازم بپرس درباره‌ی آخرین پروژه‌ای که کدنویسی کردم.',
      },
    ],
  },
  {
    displayName: 'Shida Akbari',
    promptAnswers: [
      { promptId: 'weird-fact', answer: 'همیشه یه دفترچه شعر همراهمه.' },
      {
        promptId: 'perfect-sunday',
        answer: 'یه یکشنبه‌ی ایده‌آل با یه آهنگ سنتی و یه فنجون چای می‌گذره.',
      },
    ],
  },
  {
    displayName: 'Kamran Farhadi',
    promptAnswers: [
      {
        promptId: 'best-night',
        answer: 'بهترین شبم زیر آسمون پر ستاره‌ی روستامونه.',
      },
      {
        promptId: 'never-say-no-to',
        answer: 'هیچ‌وقت جواب رد نمی‌دم به یه پیاده‌روی توی جنگل.',
      },
    ],
  },
  {
    displayName: 'Roya Najafi',
    promptAnswers: [
      {
        promptId: 'best-night',
        answer: 'وقتی بعد یه روز شنا کنار دریا غروب رو تماشا می‌کنم.',
      },
      {
        promptId: 'never-say-no-to',
        answer: 'هیچ‌وقت جواب رد نمی‌دم به یه شنای صبحگاهی.',
      },
    ],
  },
  {
    displayName: 'Sina Bahrami',
    promptAnswers: [
      {
        promptId: 'weird-fact',
        answer: 'می‌تونم چند ساعت فقط نقاشی کنم و هیچی نگم.',
      },
      {
        promptId: 'ask-me-about',
        answer: 'ازم بپرس درباره‌ی آخرین نمایشی که توش بازی کردم.',
      },
    ],
  },
  {
    displayName: 'Elnaz Heidari',
    promptAnswers: [
      {
        promptId: 'cant-live-without',
        answer: 'بدون یه جلسه مدیتیشن روزم کامل نمی‌شه.',
      },
      {
        promptId: 'perfect-sunday',
        answer: 'یه یکشنبه‌ی ایده‌آل با یوگا و یه پیاده‌روی آرومه.',
      },
    ],
  },
];

interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

interface ProfilePatchResponse {
  promptAnswers?: PromptAnswer[];
  profileCompletedAt?: string | null;
}

// Same real fetch-and-parse shape as load-test/lib/virtual-user.ts's own
// apiCall() (not reused directly — that helper isn't exported) — an
// explicit `as T` on a genuinely dynamic JSON response, same as there.
async function patchPromptAnswers(
  token: string,
  promptAnswers: PromptAnswer[],
): Promise<ApiResult<ProfilePatchResponse>> {
  const res = await fetch(`${BASE_URL}/v1/profile`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ promptAnswers }),
  });
  const text = await res.text();
  const body = text
    ? (JSON.parse(text) as ProfilePatchResponse)
    : (undefined as unknown as ProfilePatchResponse);
  return { status: res.status, body };
}

async function main(): Promise<void> {
  assertSafeTarget(BASE_URL);
  console.log(
    `Backfilling prompt answers for ${BACKFILL.length} seed user(s) against ${BASE_URL}...`,
  );

  let succeeded = 0;
  const failed: string[] = [];
  const stillIncomplete: string[] = [];

  for (const [i, entry] of BACKFILL.entries()) {
    const phone = `+1900555${String(i + 1).padStart(4, '0')}`;
    try {
      const user = new VirtualUser(BASE_URL, phone);
      await user.signUp(); // a real login for this already-existing phone — same OTP flow, not a new signup.
      const result = await patchPromptAnswers(user.token, entry.promptAnswers);
      if (result.status !== 200) {
        throw new Error(
          `PATCH /v1/profile failed: ${result.status} ${JSON.stringify(result.body)}`,
        );
      }
      // Acceptance criterion (docs/requirements.md Feature 24): every seed
      // user must still have a real, non-null profileCompletedAt afterward.
      if (!result.body.profileCompletedAt) {
        stillIncomplete.push(entry.displayName);
      }
      succeeded++;
      console.log(`  ✓ ${entry.displayName} (${phone})`);
    } catch (err) {
      failed.push(entry.displayName);
      console.error(
        `  ✗ ${entry.displayName} (${phone}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(
    `\nDone. Succeeded: ${succeeded}/${BACKFILL.length}, failed: ${failed.length}.`,
  );
  if (failed.length > 0) {
    console.log('Failed:', failed);
  }
  if (stillIncomplete.length > 0) {
    console.log(
      'WARNING — profileCompletedAt is still null for (real finding, investigate before trusting the backfill):',
      stillIncomplete,
    );
  } else {
    console.log(
      'Verified: every user that succeeded still has a real, non-null profileCompletedAt.',
    );
  }

  process.exitCode = failed.length > 0 || stillIncomplete.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Backfill script crashed:', err);
  process.exit(1);
});
