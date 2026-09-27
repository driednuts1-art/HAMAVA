import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { uniquePhone, loginAndReachChoiceScreen } from "./helpers";

// Mirrors date-share.spec.ts's own identical helper (same real
// DATABASE_URL, same sibling-backend .env) — not extracted into a shared
// file since exactly two call sites exist so far.
function readBackendDatabaseUrl(): string {
  const envPath = path.resolve(__dirname, "../../backend/.env");
  const contents = fs.readFileSync(envPath, "utf-8");
  const match = contents.match(/^DATABASE_URL="(.+)"$/m);
  if (!match) throw new Error("DATABASE_URL not found in backend/.env");
  return match[1];
}

/**
 * Feature 23 (docs/requirements.md) — real screenshot + computed-style
 * capture for the visual design-system compliance audit. Not a functional
 * test suite (no correctness assertions beyond "the real flow reached this
 * real state") — its only job is producing real evidence (FR-424..426) for
 * a human/Claude visual review against docs/design-system.md.
 *
 * Reuses the real 20 seed users (docs/test-users.md) and their 5 real
 * existing matches wherever a specific relationship is needed, per this
 * feature's own §3 — new users are created only for states that need a
 * genuinely fresh, one-time condition (a brand-new profile, a first-ever
 * match, a first-ever match-open) that the seed data can't provide without
 * being consumed.
 */

const OUT_DIR = path.resolve(__dirname, "../visual-audit-output");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Feature 26 (FR-475): a real finding from re-reading playwright.config.ts
// directly — this whole suite was running at `devices["Desktop Chrome"]`'s
// default desktop viewport the entire time, never actually the "mobile-
// width" every prior screenshot was described as. This app has no
// responsive breakpoint anywhere (confirmed: no `max-w-*`/`sm:`/`md:` guard
// in app/(tabs)/layout.tsx), so every capture was silently stretching
// flex-1 content across ~1280px instead of a real phone's ~375px — exactly
// the condition that made /matches's own dead-gap bug invisible in every
// prior screenshot despite being reproducible at real mobile width too.
test.use({ viewport: { width: 375, height: 812 } });

const SEED_PHONE_ALI = "+19005550001"; // Ali Rezaei — verified, complete profile, matched with Sara Ahmadi
// NOTE (this whole file): seed user display names below (Ali Rezaei, Sara
// Ahmadi, ...) are real, live docs/test-users.md dev-DB data. The former
// seed-data re-seeding open decision (docs/i18n-rtl-migration-scope.md
// §5.1) is now resolved — global audience — and all 20 real seed users were
// renamed to their Latin-transliterated English identity via a real
// PATCH /v1/profile against the same existing accounts (2026-09-25,
// docs/test-users.md "Global identity rename"), never deleted/recreated, so
// every real match/swipe these accounts carry survived unchanged. The names
// below reflect that real, current state.

/**
 * Feature 26: a real, confirmed finding — `fullPage: true` on a page taller
 * than one viewport, with `TabBar`'s own `position: fixed` nav, makes
 * Playwright's stitching repeat the fixed nav (and whatever content sits
 * behind it) at each viewport-height boundary — a real screenshot-capture
 * artifact, not a real product bug (confirmed by comparing against a live,
 * viewport-only screenshot of the identical real page: the underlying app
 * renders correctly, only the *stitched full-page PNG* shows the
 * duplication). FR-425 (Feature 23) still wants a real full-page capture
 * (nothing below the fold silently skipped) — the fix is hiding the nav
 * for the instant of the capture, not switching every capture to
 * viewport-clipped. `viewportOnly` is the other real half of this same
 * finding: a genuine `position: fixed` *overlay* (`IncomingCallOverlay`,
 * capture 32) is the actual subject of its own capture, not something to
 * hide — hiding it would remove the one thing being reviewed, so those
 * calls pass `viewportOnly: true` instead (nothing meaningful exists below
 * a full-screen modal's own first viewport anyway).
 */
async function capture(
  page: Page,
  name: string,
  options: { viewportOnly?: boolean } = {},
) {
  await page.waitForTimeout(300); // settle any in-flight fade/transition
  const pngPath = path.join(OUT_DIR, `${name}.png`);
  if (options.viewportOnly) {
    await page.screenshot({ path: pngPath, fullPage: false });
  } else {
    await page.evaluate(() => {
      const nav = document.querySelector("nav");
      if (nav) (nav as HTMLElement).style.display = "none";
    });
    await page.screenshot({ path: pngPath, fullPage: true });
    await page.evaluate(() => {
      const nav = document.querySelector("nav");
      if (nav) (nav as HTMLElement).style.display = "";
    });
  }

  const styleData = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const svgs = Array.from(document.querySelectorAll("svg")).slice(0, 20).map((svg) => ({
      viewBox: svg.getAttribute("viewBox"),
      strokeWidth: svg.getAttribute("stroke-width"),
    }));
    const heading = document.querySelector("h1, h2");
    const headingStyle = heading ? getComputedStyle(heading) : null;
    return {
      bodyFontFamily: body.fontFamily,
      bodyColor: body.color,
      bodyBackgroundColor: body.backgroundColor,
      headingFontWeight: headingStyle?.fontWeight ?? null,
      headingFontFamily: headingStyle?.fontFamily ?? null,
      svgSample: svgs,
    };
  });
  fs.writeFileSync(
    path.join(OUT_DIR, `${name}.json`),
    JSON.stringify(styleData, null, 2),
  );
}

async function loginSeedAli(page: Page): Promise<void> {
  await loginSeed(page, SEED_PHONE_ALI);
}

/** Feature 26 (FR-476): a real, standalone screenshot of one element, used
 * for the persistent tab bar/header direct-check requirement — a plain
 * full-page capture only ever shows it in the background of some other
 * screen's own subject. */
async function captureElement(page: Page, selector: string, name: string) {
  await page.waitForTimeout(300);
  await page.locator(selector).screenshot({
    path: path.join(OUT_DIR, `${name}.png`),
  });
}

/**
 * Feature 26: a real, general-purpose seed login (any of the 20
 * `docs/test-users.md` phones), not hardcoded to Ali Rezaei — used so this
 * feature's own new/re-verified captures (#10, #14, and the new §4.B
 * screens) can reuse already-complete, already-verified seed accounts
 * instead of `loginAndCompleteProfile()`'s fresh signup + real photo
 * upload. Real, concrete reason: a fresh signup's photo upload triggers
 * real OpenAI image moderation, and this project's real OpenAI account
 * balance is genuinely exhausted right now (`docs/roadmap.md`, "Before
 * production") — captures #10/#14 originally used fresh signups and were
 * the only two screens in this whole suite that actually needed OpenAI at
 * all. Switching them to real, already-complete seed accounts removes
 * that dependency entirely, matching this feature's own explicit claim
 * (docs/requirements.md Feature 26 §7) that it isn't blocked by the credit
 * outage — a claim that's only true once these two are fixed too.
 */
async function loginSeed(page: Page, phone: string): Promise<string> {
  const verifyResponsePromise = page.waitForResponse(
    (r) => r.url().endsWith("/api/auth/verify") && r.request().method() === "POST",
  );
  await page.goto("/login");
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  const codeInput = page.getByLabel("Verification code");
  await expect(codeInput).toHaveValue(/^\d{6}$/, { timeout: 10_000 });
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL("http://localhost:3001/", { timeout: 10_000 });
  const body = (await (await verifyResponsePromise).json()) as { user: { id: string } };
  return body.user.id;
}

async function forceDeckTarget(page: Page, targetId: string, name: string) {
  await page.route("**/v1/discovery/deck*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        candidates: [
          {
            id: targetId,
            displayName: name,
            age: 30,
            city: "Toronto",
            bio: "A sample bio for the visual audit.",
            interests: ["Reading", "Travel"],
            verified: true,
            photos: [],
            // Feature 24: CandidateCard now unconditionally reads these —
            // a real bug found running this suite (an outdated mock literal
            // missing them crashed the whole page with a real, uncaught
            // TypeError). The real backend always includes them via
            // candidate-profile-fields.util.ts, so a real mock must too.
            promptAnswers: [],
            height: null,
            education: null,
            exerciseHabit: null,
            hasKids: null,
            zodiacSign: null,
            politicalView: null,
            hometown: null,
            languages: [],
            drinking: null,
            smoking: null,
          },
        ],
        nextCursor: null,
      }),
    }),
  );
}

/**
 * §5's signature moment takes ~2s to fully appear — a bare `.isVisible()`
 * (no real wait, unlike `expect().toBeVisible()`) checked immediately after
 * navigation reliably raced ahead of it and clicked through to a covered
 * element instead. Real bug, found running this exact file.
 */
async function dismissMatchMomentIfPresent(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "You matched" });
  const appeared = await dialog
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await dialog.click();
    await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  }
}

async function createRealMatch(
  page1: Page,
  userId1: string,
  page2: Page,
  userId2: string,
  name1: string,
  name2: string,
): Promise<void> {
  await forceDeckTarget(page1, userId2, name2);
  await page1.goto("/");
  const like1 = page1.getByRole("button", { name: "Like", exact: true });
  await expect(like1).toBeVisible({ timeout: 10_000 });
  // A real race found running this exact file's own full-suite regression
  // (capture 10 passed reliably in isolation, under light load, but failed
  // under the heavier load of running after 5 preceding tests): click()
  // only waits for the browser click event, not the resulting real swipe
  // request — without this explicit wait, page2's own "completing" swipe
  // below could reach the backend before page1's first swipe was actually
  // persisted, creating two one-sided likes instead of a real mutual match.
  const swipe1Response = page1.waitForResponse(
    (r) => r.url().endsWith("/v1/discovery/swipes") && r.request().method() === "POST",
  );
  await like1.click();
  await swipe1Response;

  await forceDeckTarget(page2, userId1, name1);
  await page2.goto("/");
  const like2 = page2.getByRole("button", { name: "Like", exact: true });
  await expect(like2).toBeVisible({ timeout: 10_000 });
  const swipe2Response = page2.waitForResponse(
    (r) => r.url().endsWith("/v1/discovery/swipes") && r.request().method() === "POST",
  );
  await like2.click();
  await swipe2Response;
}

test.describe.configure({ mode: "serial" });

// ---- 01-03: Login flow ----
test("capture 01-03: login (phone / otp / liveness)", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/login");
  await capture(page, "01-login-phone");

  await page.getByLabel("Phone number").fill(uniquePhone());
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Verification code")).toHaveValue(/^\d{6}$/, { timeout: 10_000 });
  await capture(page, "02-login-otp");

  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Live identity verification")).toBeVisible({ timeout: 10_000 });
  await capture(page, "03-login-liveness");
});

// ---- 04-06: Profile setup ----
test("capture 04: profile choice screen", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAndReachChoiceScreen(page, uniquePhone());
  await capture(page, "04-profile-choice");
});

test("capture 05: profile manual form", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAndReachChoiceScreen(page, uniquePhone());
  await page.getByRole("button", { name: "Manual form" }).click();
  await expect(page.getByLabel("Name")).toBeVisible({ timeout: 10_000 });
  await capture(page, "05-profile-manual-form");
});

test("capture 06: profile conversational setup", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAndReachChoiceScreen(page, uniquePhone());
  await page.getByRole("button", { name: "Chat with AI" }).click();
  await expect(page.getByLabel("Message")).toBeVisible({ timeout: 15_000 });
  await capture(page, "06-profile-conversational");
});

// ---- 07-09: Discovery ----
test("capture 07-09: discovery deck / filters / ai-search", async ({ page }) => {
  test.setTimeout(60_000);
  await loginSeedAli(page);
  await expect(page.getByRole("button", { name: "Filters" })).toBeVisible({ timeout: 10_000 });
  await capture(page, "07-discovery-deck");

  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByText("Filters", { exact: true })).toBeVisible({ timeout: 5_000 });
  await capture(page, "08-discovery-filters");
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "AI Search" }).click();
  await expect(page.getByLabel("AI Search")).toBeVisible({ timeout: 5_000 });
  await capture(page, "09-discovery-ai-search");
});

// ---- 10: In-deck match confirmation ----
// Feature 26: a real, currently-unmatched verified seed pair, picked via a
// genuine DB query each run (not a hardcoded pair — a real bug found running
// this exact file after Feature 29's own regression: a previously hardcoded
// pair was confirmed via a real query to already have a real, pre-existing
// match — one of the 20 seed users' own matches, not something this file's
// own runs had consumed — so the swipe here never produced a fresh
// `matched: true`, and the deck correctly showed "No one left for now"
// afterward since the injected single-candidate deck had nothing left). Not
// fresh signups — see loginSeed()'s own comment for why.
//
// Real, found-on-request resilience fix (2026-09-25): the pool below is
// keyed by real, stable user id, not displayName — ids never change even
// when a seed user is renamed (this file's own names just went through
// exactly that, the English/global identity rename), so this pool survives
// a future rename automatically; only an actual re-seed (genuinely new
// accounts) would ever need this list touched again. The real, CURRENT
// displayName is looked up fresh from the DB every run below, never
// hardcoded — deliberately NOT a fully open "any two verified users" query,
// since that would risk picking arbitrary, un-curated e2e-test-junk
// accounts instead of these deliberately good-looking demo profiles, which
// is the whole point of a visual design audit.
async function findUnmatchedVerifiedPair(): Promise<
  [{ name: string; phone: string }, { name: string; phone: string }]
> {
  // Every verified seed user except Sina Bahrami (capture 23 below needs
  // her to genuinely still have zero matches, and this test runs first).
  const pool = [
    { id: "2567c330-30c5-45ed-9171-c90d1995d0a5", phone: "+19005550001" }, // Ali Rezaei
    { id: "2d2fd27d-e042-42f3-8599-99937bb2c5c5", phone: "+19005550002" }, // Sara Ahmadi
    { id: "4acb7483-5266-4940-9491-ca7dbaeec589", phone: "+19005550004" }, // Negar Hosseini
    { id: "e3e05606-412b-4e2f-be69-752d3724c769", phone: "+19005550005" }, // Hossein Karimi
    { id: "1bb83862-9fbd-4975-a63d-83d1ec96cf6e", phone: "+19005550007" }, // Amir Nouri
    { id: "f1a8cc4b-30e4-4e0a-a02b-7a587a0c2531", phone: "+19005550008" }, // Zahra Rostami
    { id: "2733312c-b936-4733-ab4e-a7f1f7662992", phone: "+19005550010" }, // Leila Sharifi
    { id: "21253fa0-2009-46b3-ad2a-ab298d182507", phone: "+19005550011" }, // Kian Moradi
    { id: "4ec92531-00a2-4f88-9c40-d90720387d42", phone: "+19005550012" }, // Yasaman Ghasemi
    { id: "8a9c900a-538f-4256-ad0a-26c8db8fb28a", phone: "+19005550014" }, // Niloufar Azizi
    { id: "15087f33-e616-407c-8592-94121e3d1ee4", phone: "+19005550015" }, // Pouya Jafari
    { id: "814f3d86-d7e1-49ac-8053-7476c0e00a8e", phone: "+19005550017" }, // Kamran Farhadi
    { id: "95a05b1e-a463-4e94-a0aa-8678631ba141", phone: "+19005550018" }, // Roya Najafi
  ];
  const pgPool = new Pool({ connectionString: readBackendDatabaseUrl() });
  try {
    const ids = pool.map((p) => p.id);
    const users = await pgPool.query(
      'SELECT id, "displayName" FROM users WHERE id = ANY($1)',
      [ids],
    );
    const nameById = new Map<string, string>(
      users.rows.map((r: { id: string; displayName: string }) => [r.id, r.displayName]),
    );
    const matches = await pgPool.query(
      'SELECT "userAId", "userBId" FROM matches WHERE "userAId" = ANY($1) AND "userBId" = ANY($1)',
      [ids],
    );
    // A real, second gap found running this exact file's own full-suite
    // regression: excluding only existing *matches* isn't enough — the real
    // backend rejects a swipe with a genuine 409 ("You have already swiped
    // on this candidate") the moment EITHER side has swiped on the other
    // before, even with no match ever formed (a one-sided LIKE or a PASS
    // from an earlier run of this file). Confirmed directly by temporarily
    // logging both real swipe responses and seeing this exact 409 on both.
    const swipes = await pgPool.query(
      'SELECT "actorId", "targetId" FROM swipes WHERE "actorId" = ANY($1) AND "targetId" = ANY($1)',
      [ids],
    );
    const unavailablePairs = new Set([
      ...matches.rows.map(
        (r: { userAId: string; userBId: string }) => [r.userAId, r.userBId].sort().join(":"),
      ),
      ...swipes.rows.map(
        (r: { actorId: string; targetId: string }) => [r.actorId, r.targetId].sort().join(":"),
      ),
    ]);
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const idA = pool[i].id;
        const idB = pool[j].id;
        const key = [idA, idB].sort().join(":");
        if (unavailablePairs.has(key)) continue;
        const nameA = nameById.get(idA);
        const nameB = nameById.get(idB);
        if (!nameA || !nameB) continue; // a real id no longer exists — skip, don't crash
        return [
          { name: nameA, phone: pool[i].phone },
          { name: nameB, phone: pool[j].phone },
        ];
      }
    }
    throw new Error(
      "findUnmatchedVerifiedPair: every candidate pair in the pool is already matched or already swiped — widen the pool.",
    );
  } finally {
    await pgPool.end();
  }
}

test("capture 10: in-deck match confirmation", async ({ browser }) => {
  test.setTimeout(90_000);
  const c1 = await browser.newContext();
  const c2 = await browser.newContext();
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();
  const [user1, user2] = await findUnmatchedVerifiedPair();
  const n1 = user1.name;
  const n2 = user2.name;
  try {
    const id1 = await loginSeed(p1, user1.phone);
    const id2 = await loginSeed(p2, user2.phone);
    await createRealMatch(p1, id1, p2, id2, n1, n2);
    // Correction: this string is real, current, and intentional —
    // components/discovery/match-confirmation.tsx's own comment explains
    // it's a deliberately simpler in-deck banner, distinct from Feature 17's
    // reserved signature match-moment (which does say "In Harmony!", a
    // different component entirely) — an earlier pass wrongly assumed the
    // two were the same UI moment and "fixed" this to the wrong string;
    // reverted after checking the actual target component's real source.
    await expect(p2.getByText("It's a match!")).toBeVisible({ timeout: 10_000 });
    await capture(p2, "10-discovery-match-confirmation");
  } finally {
    // A second, compounding bug found alongside the stale string: without
    // this, the assertion above throwing left both contexts open — real
    // evidence this caused the exact same 12 subsequent tests to silently
    // never run in two separate full-suite attempts (docs/roadmap.md).
    await c1.close();
    await c2.close();
  }
});

// ---- 11-13: Matches list + chat ----
test("capture 11-13: matches list / chat (first open) / chat (seen)", async ({ page }) => {
  test.setTimeout(60_000);
  await loginSeedAli(page);
  await page.goto("/matches");
  // Real bug found running this exact file: capturing right after the
  // heading appears, before the real match row's own name/photo finish
  // rendering, produced a screenshot of empty skeleton rows. Wait for the
  // real link text itself.
  const link = page.getByRole("link", { name: "Sara Ahmadi" });
  await expect(link).toBeVisible({ timeout: 10_000 });
  await capture(page, "11-matches-list");

  await link.click();
  // First open this session (fresh Playwright context → fresh localStorage
  // → docs/design-system.md §5's signature moment fires for real).
  await expect(page.getByRole("dialog", { name: "You matched" })).toBeVisible({
    timeout: 10_000,
  });
  // §5's own choreography runs ~2s total (slide-in → burst → text), driven
  // by Framer Motion's own opacity animation on <motion.h1> — real bug
  // found running this exact file, twice: `expect(...).toBeVisible()`
  // reports true the instant the element ATTACHES (Playwright's visibility
  // check doesn't wait for a CSS/JS opacity tween to actually reach 1), so
  // it passed while the text was still at or near opacity:0, well before
  // it had actually faded in — the real match-moment.tsx component (read
  // directly) is correctly built exactly per §5's choreography; this was
  // purely a capture-script timing bug, not a product bug. A real wait
  // matching the animation's own total duration, not a DOM-attachment
  // check, is what's actually needed here.
  await page.waitForTimeout(2_300);
  await capture(page, "13-match-signature-moment");
  await page.getByRole("dialog", { name: "You matched" }).click();

  // Now "seen" — reload lands directly on the plain chat view. A bare
  // "dialog not visible" check (true immediately after a fresh reload,
  // before React has even mounted) produced a fully blank screenshot —
  // found running this exact file. Wait for real chat content instead.
  await page.reload();
  await expect(page.getByText("Sara Ahmadi")).toBeVisible({ timeout: 10_000 });
  await capture(page, "12-match-chat");
});

// ---- 14: In-call screen ----
// Feature 26: real, already-matched seed users (Amir Nouri/Leila Sharifi —
// one of the real matches, docs/test-users.md), not fresh signups — same
// reasoning as capture 10 above. Already matched, so no swipe/match step is
// needed at all here — straight to the real call flow.
test("capture 14: in-call screen", async ({ browser }) => {
  test.setTimeout(90_000);
  const c1 = await browser.newContext({ permissions: ["microphone", "camera"] });
  const c2 = await browser.newContext({ permissions: ["microphone", "camera"] });
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();
  const n2 = "Leila Sharifi";
  await loginSeed(p1, "+19005550007"); // Amir Nouri
  await loginSeed(p2, "+19005550010"); // Leila Sharifi
  // p2 stays on "/" (the tabs layout, whose app-wide useCallListening()
  // socket is already connected) rather than a fresh page.goto() — a real
  // bug found running this exact file originally: goto() is a full
  // navigation, tearing down and re-establishing the socket, and racing
  // p1's call start against that reconnect genuinely dropped the real-time
  // call:incoming event.

  await p1.goto("/matches");
  await p1.getByRole("link", { name: n2 }).click();
  await dismissMatchMomentIfPresent(p1);
  await p1.getByRole("button", { name: "Voice call" }).click();
  await expect(p1.getByRole("dialog", { name: "Call" })).toBeVisible({ timeout: 10_000 });

  const incoming = p2.getByRole("dialog", { name: "Incoming call" });
  await expect(incoming).toBeVisible({ timeout: 15_000 });
  // Feature 26 (#32): the real IncomingCallOverlay, its own never-before-
  // audited component — captured here since this is the one real place a
  // genuine incoming call naturally exists, not a separate test.
  await capture(p2, "32-call-incoming-overlay", { viewportOnly: true });
  await p2.getByRole("button", { name: "Answer call" }).click();

  const elapsedPattern = /^\d{2}:\d{2}$/;
  await expect(p1.getByText(elapsedPattern)).toBeVisible({ timeout: 30_000 });
  await capture(p1, "14-call-in-call-screen");

  await p1.getByRole("button", { name: "Hang up" }).click();
  await c1.close();
  await c2.close();
});

// ---- 15-19: Settings ----
test("capture 15-19: settings + sub-pages", async ({ page }) => {
  test.setTimeout(60_000);
  await loginSeedAli(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
  await capture(page, "15-settings-main");

  await page.goto("/settings/help");
  await expect(page.getByText("Help Center")).toBeVisible({ timeout: 5_000 });
  await capture(page, "16-settings-help");

  await page.goto("/settings/safety");
  await expect(page.getByText("Safety")).toBeVisible({ timeout: 5_000 });
  await capture(page, "17-settings-safety");

  await page.goto("/settings/privacy-policy");
  await expect(page.getByText("The official text of this document")).toBeVisible({ timeout: 5_000 });
  await capture(page, "18-settings-privacy-policy");

  await page.goto("/settings/terms");
  await expect(page.getByText("The official text of this document")).toBeVisible({ timeout: 5_000 });
  await capture(page, "19-settings-terms");
});

// ---- 20-21: Share My Date ----
test("capture 20-21: share my date (manage sheet + public page)", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await loginSeedAli(page);
  await page.goto("/matches");
  await page.getByRole("link", { name: "Sara Ahmadi" }).click();
  // May or may not be the first open this run — either way, the plain chat
  // header is reachable once any signature-moment dialog is dismissed.
  await dismissMatchMomentIfPresent(page);

  await page.getByRole("button", { name: "Share date" }).click();
  await expect(page.getByRole("button", { name: "Create link" })).toBeVisible({ timeout: 10_000 });
  await capture(page, "20-date-share-manage-sheet");

  const yearOptions = await page
    .getByLabel("Date year (Persian calendar)")
    .locator("option")
    .allTextContents();
  await page
    .getByLabel("Date year (Persian calendar)")
    .selectOption(String(Math.max(...yearOptions.map(Number))));
  await page
    .getByPlaceholder("e.g. Café X, Main Street")
    .fill("Visual audit test location");
  await page.getByRole("button", { name: "Create link" }).click();

  const linkLocator = page.locator("text=/http:\\/\\/localhost:3001\\/date\\//");
  await expect(linkLocator).toBeVisible({ timeout: 10_000 });
  const linkText = (await linkLocator.textContent())!;
  const url = linkText.match(/http:\/\/localhost:3001\/date\/\S+/)![0];

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(url);
  await expect(publicPage.getByText("Sara Ahmadi", { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  await capture(publicPage, "21-date-share-public-page");
  await publicContext.close();
});

// ==================================================================
// Feature 26 (docs/requirements.md §4.B) — genuinely new screens/states
// never audited by Feature 23. All real seed users below (never fresh
// signups) — no OpenAI-touching call is made anywhere in this section,
// per this feature's own §7 claim.
// ==================================================================

// ---- 22: Discovery — empty deck ----
test("capture 22: discovery empty deck", async ({ page }) => {
  test.setTimeout(30_000);
  await page.route("**/v1/discovery/deck*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ candidates: [], nextCursor: null }),
    }),
  );
  await loginSeed(page, "+19005550012"); // Yasaman Ghasemi
  await expect(page.getByText("No one left for now")).toBeVisible({ timeout: 10_000 });
  await capture(page, "22-discovery-empty-deck");
});

// ---- 23: Matches — empty ----
test("capture 23: matches list empty", async ({ page }) => {
  test.setTimeout(30_000);
  // Sina Bahrami — real, confirmed zero matches, and (unlike Elnaz Heidari,
  // the first pick here) actually verified: an unverified seed user's real
  // login flow stops at the liveness-consent step first, which loginSeed()
  // doesn't handle — a real test-data mistake found by running this
  // exact test, not a product bug.
  await loginSeed(page, "+19005550019");
  await page.goto("/matches");
  await expect(page.getByText("No matches yet")).toBeVisible({ timeout: 10_000 });
  await capture(page, "23-matches-empty");
});

// ---- 24: Matches — chat, real message thread (bubble density) ----
test("capture 24: matches chat, real message thread", async ({ browser }) => {
  test.setTimeout(60_000);
  const c1 = await browser.newContext();
  const c2 = await browser.newContext();
  const page1 = await c1.newPage();
  const page2 = await c2.newPage();
  await loginSeed(page1, SEED_PHONE_ALI); // Ali Rezaei
  await loginSeed(page2, "+19005550002"); // Sara Ahmadi — already matched with Ali
  await page1.goto("/matches");
  await page1.getByRole("link", { name: "Sara Ahmadi" }).click();
  await dismissMatchMomentIfPresent(page1);
  await page2.goto("/matches");
  await page2.getByRole("link", { name: "Ali Rezaei" }).click();
  await dismissMatchMomentIfPresent(page2);

  const messages: [Page, string][] = [
    [page1, "Hi! How are you?"],
    [page2, "Hi, I'm good thanks! How about you?"],
    [page1, "I'm good. Free to go out this weekend?"],
    [page2, "Sure, where do you want to go?"],
  ];
  for (const [sender, text] of messages) {
    await sender.getByLabel("Message").fill(text);
    await sender.getByRole("button", { name: "Send" }).click();
    await expect(sender.getByText(text)).toBeVisible({ timeout: 10_000 });
  }
  await page1.waitForTimeout(500);
  await capture(page1, "24-matches-chat-real-thread");
  await c1.close();
  await c2.close();
});

// ---- 25/26: Who Liked Me — populated + empty ----
test("capture 25: who liked me, populated", async ({ page }) => {
  test.setTimeout(30_000);
  // Hossein Karimi — expected a real, existing super-like from Ali Rezaei
  // sitting unreciprocated. KNOWN STALE (docs/roadmap.md Watch items,
  // 2026-09-25): a direct DB check found this pair already turned into a
  // real match on 2026-09-16, days before that finding — the precondition
  // this capture depends on is gone, unrelated to today's rename, tracked
  // separately, not fixed here.
  await loginSeed(page, "+19005550005");
  await page.goto("/liked");
  await expect(page.getByText("Ali Rezaei")).toBeVisible({ timeout: 10_000 });
  await capture(page, "25-who-liked-me-populated");
});

test("capture 26: who liked me, empty", async ({ page }) => {
  test.setTimeout(30_000);
  // Every real seed user with genuinely zero likes received (Shida Akbari,
  // Bahram Yazdani, Arash Taheri) is also deliberately unverified — logging in
  // as any of them would permanently flip that real, deliberately-kept
  // verification flag the moment the liveness-consent step is clicked
  // through (MockLivenessProvider always passes), corrupting curated
  // seed-user data other suites (settings.spec.ts) depend on. A route-mock
  // on a real, already-verified seed user is the safe way to show this
  // empty state visually without touching real backend state.
  await page.route("**/v1/discovery/who-liked-me*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ candidates: [], nextCursor: null }),
    }),
  );
  await loginSeedAli(page);
  await page.goto("/liked");
  await expect(page.getByText("No one has liked you yet")).toBeVisible({ timeout: 10_000 });
  await capture(page, "26-who-liked-me-empty");
});

// ---- 27: Profile — Feature 25 default view mode ----
test("capture 27: profile Feature 25 view mode", async ({ page }) => {
  test.setTimeout(30_000);
  await loginSeedAli(page);
  await page.goto("/profile");
  await expect(page.getByRole("button", { name: "Edit Profile" })).toBeVisible({
    timeout: 10_000,
  });
  await capture(page, "27-profile-view-mode");
});

// ---- 28/29: AI Search — text results + voice recording ----
test("capture 28-29: ai search text results / voice recording", async ({ page }) => {
  test.setTimeout(60_000);
  await loginSeedAli(page);
  await page.getByRole("button", { name: "AI Search" }).click();
  await page.getByLabel("AI Search").fill("someone serious, who loves books and hiking");
  await page.getByRole("button", { name: "Find with AI" }).click();

  // Real finding, found by running this exact test, not assumed: the real
  // extraction call hit the same live OpenAI credit exhaustion already
  // documented in docs/roadmap.md ("Before production") — confirmed via
  // the real error-context snapshot: "Search extraction service returned
  // 429." The successful "results" state (#28 as originally planned)
  // genuinely cannot be captured until real credit is restored — captured
  // honestly as the real current fallback state instead, not faked or
  // skipped silently. See docs/visual-audit-findings.md's Feature 26
  // section for the explicit deferral.
  // exact: true — "Search" is otherwise a substring of the "AI Search" tab
  // button also on screen, a real ambiguity introduced by translation (see
  // discovery.spec.ts's identical fix).
  const resultsForm = page.getByRole("button", { name: "Search", exact: true });
  const vendorError = page.getByText("AI Search is unavailable");
  await expect(resultsForm.or(vendorError)).toBeVisible({ timeout: 15_000 });
  if (await vendorError.isVisible()) {
    await capture(page, "28-ai-search-real-vendor-error-current-outage");
  } else {
    await capture(page, "28-ai-search-text-results");
  }

  await page.reload();
  await page.getByRole("button", { name: "AI Search" }).click();
  const startButton = page.getByRole("button", { name: "Start voice recording" });
  await expect(startButton).toBeVisible({ timeout: 10_000 });
  await startButton.click();
  await expect(page.getByText("Say who you're looking for")).toBeVisible({ timeout: 5_000 });
  await capture(page, "29-ai-search-voice-recording");
  await page.getByRole("button", { name: "Stop recording" }).click();
});

// ---- 33: Tab bar — standalone, direct check ----
test("capture 33: tab bar standalone", async ({ page }) => {
  test.setTimeout(30_000);
  await loginSeedAli(page);
  await expect(page.locator("nav")).toBeVisible({ timeout: 10_000 });
  await captureElement(page, "nav", "33-tab-bar-standalone");
});
