import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { toJalaali } from "jalaali-js";
import { test, expect, type Page } from "@playwright/test";
import { uniquePhone, loginAndCompleteProfile } from "./helpers";

// Feature 19 (Share My Date) — real backend, real Postgres. The public page
// (app/date/[token]/page.tsx) is genuinely unauthenticated, so every test
// here that opens it uses a fresh browser context with zero cookies,
// matching the real scenario a trusted contact is actually in.

// FR-164/Open Items #4 (user-confirmed decision): rather than waiting a real
// 24 real hours for DATE_SHARE_LINK_BUFFER_HOURS to naturally expire a link,
// the expired-link test manipulates a real row's `expiresAt` directly via
// Postgres — reading the real DATABASE_URL from the sibling backend's own
// .env (this monorepo's real, single source of truth for it), matching the
// exact connection shape PrismaService itself already uses successfully
// against this same real Neon database (@prisma/adapter-pg wraps `pg` with
// nothing more than `connectionString`).
function readBackendDatabaseUrl(): string {
  const envPath = path.resolve(__dirname, "../../backend/.env");
  const contents = readFileSync(envPath, "utf-8");
  const match = contents.match(/^DATABASE_URL="(.+)"$/m);
  if (!match) throw new Error("DATABASE_URL not found in backend/.env");
  return match[1];
}

async function forceExpireDateShareLink(locationText: string): Promise<void> {
  const pool = new Pool({ connectionString: readBackendDatabaseUrl() });
  try {
    const past = new Date(Date.now() - 60_000).toISOString();
    const result = await pool.query(
      'UPDATE "date_share_links" SET "expiresAt" = $1 WHERE "locationText" = $2',
      [past, locationText],
    );
    if (result.rowCount === 0) {
      throw new Error(`No date_share_links row found for locationText=${locationText}`);
    }
  } finally {
    await pool.end();
  }
}

/** FR-156/FR-166, FR-171/FR-173: real 409 cases — creating a real match
 * through the normal app flow always yields two verified,
 * not-opted-out users (Feature 6's own VERIFIED_ONLY default makes an
 * unverified match otherwise unreachable), so these two real preconditions
 * are flipped directly on the partner's already-matched row, mirroring
 * FR-166's own stated premise that verification isn't currently revocable
 * elsewhere but must not be assumed permanent. */
async function setUserFlag(
  userId: string,
  column: "livenessStatus" | "allowInSafetyShares",
  value: boolean,
): Promise<void> {
  const pool = new Pool({ connectionString: readBackendDatabaseUrl() });
  try {
    const result = await pool.query(
      `UPDATE "users" SET "${column}" = $1 WHERE id = $2`,
      [value, userId],
    );
    if (result.rowCount === 0) {
      throw new Error(`No users row found for id=${userId}`);
    }
  } finally {
    await pool.end();
  }
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
            bio: null,
            interests: [],
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

/** A real mutual match, with the sharer's own conversation open (past the
 * real match-moment gate) — the partner side never needs to do anything
 * further, since Share My Date only requires the caller to be a real
 * participant and the partner to be verified (already true for any user
 * created via loginAndCompleteProfile). */
async function createRealMatchAndOpenConversation(
  sharer: Page,
  sharerId: string,
  sharerName: string,
  partner: Page,
  partnerId: string,
  partnerName: string,
) {
  await forceDeckTarget(sharer, partnerId, partnerName);
  await sharer.goto("/");
  const likeSharer = sharer.getByRole("button", { name: "Like", exact: true });
  await expect(likeSharer).toBeVisible({ timeout: 10_000 });
  await likeSharer.click();

  await forceDeckTarget(partner, sharerId, sharerName);
  await partner.goto("/");
  const likePartner = partner.getByRole("button", { name: "Like", exact: true });
  await expect(likePartner).toBeVisible({ timeout: 10_000 });
  await likePartner.click();

  await expect(partner.getByText("It's a match!")).toBeVisible({ timeout: 10_000 });
  await partner.getByRole("button", { name: "OK" }).click();

  await sharer.goto("/matches");
  const link = sharer.getByRole("link", { name: partnerName });
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.click();
  await sharer.getByRole("dialog", { name: "You matched" }).click();
}

/** Fills the create step (a real ~1 year out date, safely future regardless
 * of when this test runs) and submits, returning the real generated link
 * URL and the unique locationText used (so the expired-link test can find
 * the exact row it just created). */
async function createRealDateShareLink(
  page: Page,
  locationText: string,
): Promise<string> {
  await page.getByRole("button", { name: "Share date" }).click();

  // FR-381 regression guard: right after opening (before any month/year
  // change), the day dropdown reflects the real current month, and its
  // earliest option must be exactly today's real day — not 1, not anything
  // else. This exact behavior was missing from the component's first
  // implementation draft with no test catching it (docs/roadmap.md item
  // 17); asserted directly here, per explicit user follow-up, so a future
  // regression fails loudly in this suite instead of silently passing.
  const todayJalali = toJalaali(new Date());
  const dayOptionValues = await page
    .getByLabel("Date day (Persian calendar)")
    .locator("option")
    .evaluateAll((options) =>
      options.map((o) => Number((o as HTMLOptionElement).value)),
    );
  expect(Math.min(...dayOptionValues)).toBe(todayJalali.jd);

  const yearOptions = await page
    .getByLabel("Date year (Persian calendar)")
    .locator("option")
    .allTextContents();
  const nextYear = Math.max(...yearOptions.map(Number));
  await page.getByLabel("Date year (Persian calendar)").selectOption(String(nextYear));
  await page.getByPlaceholder("e.g. Café X, Main Street").fill(locationText);
  await page.getByRole("button", { name: "Create link" }).click();
  const linkBox = page.locator("text=/http:\\/\\/localhost:3001\\/date\\//");
  await expect(linkBox).toBeVisible({ timeout: 10_000 });
  return (await linkBox.textContent())!.trim();
}

test("a real Share My Date link is created from a real conversation and immediately visible via the real, unauthenticated public page (FR-378..390)", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const sharerContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const partnerContext = await browser.newContext();
  const sharer = await sharerContext.newPage();
  const partner = await partnerContext.newPage();

  const sharerName = "Share user one";
  const partnerName = "Share user two";
  const sharerId = await loginAndCompleteProfile(sharer, uniquePhone(), sharerName);
  const partnerId = await loginAndCompleteProfile(partner, uniquePhone(), partnerName);

  await createRealMatchAndOpenConversation(
    sharer,
    sharerId,
    sharerName,
    partner,
    partnerId,
    partnerName,
  );

  const locationText = `Test cafe ${Date.now()}`;
  const url = await createRealDateShareLink(sharer, locationText);
  expect(url).toContain("/date/");

  // FR-397/398: the real "Copy link" action really places the correct full
  // URL on the clipboard — not the bare token, not a stale value.
  await sharer.getByRole("button", { name: "Copy link" }).click();
  await expect(sharer.getByRole("button", { name: "Link copied" })).toBeVisible();
  const clipboardText = await sharer.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe(url);

  // FR-388/§9: a fresh, cookie-less context — the real scenario a trusted
  // contact is in — with a real, direct check that no Authorization header
  // is ever sent on the public lookup.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const lookupRequest = visitor.waitForRequest(
    (r) => r.url().includes("/v1/date-share/") && r.method() === "GET",
  );
  await visitor.goto(url);
  const request = await lookupRequest;
  expect(request.headers()["authorization"]).toBeUndefined();

  // FR-389: exactly the real backend fields — the partner's real name and a
  // fixed verified note (no `verified` field exists to read, §1), the
  // sharer's real name, and the real location text just submitted.
  await expect(visitor.getByRole("heading", { name: partnerName })).toBeVisible({
    timeout: 10_000,
  });
  await expect(visitor.getByText("Verified Hamava user")).toBeVisible();
  await expect(visitor.getByText(sharerName, { exact: false })).toBeVisible();
  await expect(visitor.getByText(locationText)).toBeVisible();

  // FR-165/FR-389: the partner's photo is real, present, and freshly signed
  // on every lookup — never a cached/stored URL. A second, independent real
  // lookup (a fresh context, no shared cache) returns a genuinely different
  // signed URL for the same photo.
  const firstPhotoSrc = await visitor.locator("img").first().getAttribute("src");
  expect(firstPhotoSrc).toBeTruthy();
  const secondVisitorContext = await browser.newContext();
  const secondVisitor = await secondVisitorContext.newPage();
  await secondVisitor.goto(url);
  await expect(secondVisitor.getByRole("heading", { name: partnerName })).toBeVisible({
    timeout: 10_000,
  });
  const secondPhotoSrc = await secondVisitor.locator("img").first().getAttribute("src");
  expect(secondPhotoSrc).toBeTruthy();
  expect(secondPhotoSrc).not.toBe(firstPhotoSrc);
  await secondVisitorContext.close();

  await sharerContext.close();
  await partnerContext.close();
  await visitorContext.close();
});

test("a real revoke makes an immediately-following real public lookup fail with the exact same generic message a never-existed token produces (FR-390)", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const sharerContext = await browser.newContext();
  const partnerContext = await browser.newContext();
  const sharer = await sharerContext.newPage();
  const partner = await partnerContext.newPage();

  const sharerName = "Revoke user one";
  const partnerName = "Revoke user two";
  const sharerId = await loginAndCompleteProfile(sharer, uniquePhone(), sharerName);
  const partnerId = await loginAndCompleteProfile(partner, uniquePhone(), partnerName);

  await createRealMatchAndOpenConversation(
    sharer,
    sharerId,
    sharerName,
    partner,
    partnerId,
    partnerName,
  );

  const locationText = `Revoke location ${Date.now()}`;
  const url = await createRealDateShareLink(sharer, locationText);

  // FR-387: switch to the manage tab and revoke — the raw URL is never
  // re-shown here, only its metadata + a revoke action. Confirmed directly:
  // no copy/share affordance exists for a link at this point, since the raw
  // token is genuinely gone server-side (§1).
  await sharer.getByRole("button", { name: "View previous links" }).click();
  await expect(sharer.getByText(locationText)).toBeVisible({ timeout: 10_000 });
  await expect(sharer.getByRole("button", { name: "Copy link" })).not.toBeVisible();
  await expect(
    sharer.getByRole("button", { name: "Share", exact: true }),
  ).not.toBeVisible();
  await sharer.getByRole("button", { name: "Revoke link" }).click();
  await sharer.getByRole("button", { name: "Yes, revoke" }).click();
  await expect(sharer.getByText("Revoked")).toBeVisible({ timeout: 10_000 });

  const revokedContext = await browser.newContext();
  const revokedVisitor = await revokedContext.newPage();
  await revokedVisitor.goto(url);
  const revokedMessage = revokedVisitor.getByText("This link is no longer valid");
  await expect(revokedMessage).toBeVisible({ timeout: 10_000 });

  // A token that never existed at all — byte-for-byte the same message.
  const neverExistedContext = await browser.newContext();
  const neverExistedVisitor = await neverExistedContext.newPage();
  await neverExistedVisitor.goto(
    "/date/aW52YWxpZC10b2tlbi10aGF0LW5ldmVyLWV4aXN0ZWQ",
  );
  const neverExistedMessage = neverExistedVisitor.getByText("This link is no longer valid");
  await expect(neverExistedMessage).toBeVisible({ timeout: 10_000 });

  expect(await revokedMessage.textContent()).toBe(await neverExistedMessage.textContent());

  await sharerContext.close();
  await partnerContext.close();
  await revokedContext.close();
  await neverExistedContext.close();
});

test("a real link whose expiresAt has genuinely passed (set directly via Postgres, per Open Items #4) fails the public lookup the same generic way (FR-164/FR-390)", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const sharerContext = await browser.newContext();
  const partnerContext = await browser.newContext();
  const sharer = await sharerContext.newPage();
  const partner = await partnerContext.newPage();

  const sharerName = "Expiry user one";
  const partnerName = "Expiry user two";
  const sharerId = await loginAndCompleteProfile(sharer, uniquePhone(), sharerName);
  const partnerId = await loginAndCompleteProfile(partner, uniquePhone(), partnerName);

  await createRealMatchAndOpenConversation(
    sharer,
    sharerId,
    sharerName,
    partner,
    partnerId,
    partnerName,
  );

  const locationText = `Expiry location ${Date.now()}`;
  const url = await createRealDateShareLink(sharer, locationText);

  // The one real, deliberate direct-DB manipulation this suite does — the
  // user's own explicit decision (Open Items #4) over waiting 24 real hours.
  await forceExpireDateShareLink(locationText);

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(url);
  await expect(visitor.getByText("This link is no longer valid")).toBeVisible({
    timeout: 10_000,
  });

  await sharerContext.close();
  await partnerContext.close();
  await visitorContext.close();
});

test("a real, already-authenticated user opening a real share link sees the identical public view — no redirect loop (FR-393)", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const sharerContext = await browser.newContext();
  const partnerContext = await browser.newContext();
  const sharer = await sharerContext.newPage();
  const partner = await partnerContext.newPage();

  const sharerName = "Login user one";
  const partnerName = "Login user two";
  const sharerId = await loginAndCompleteProfile(sharer, uniquePhone(), sharerName);
  const partnerId = await loginAndCompleteProfile(partner, uniquePhone(), partnerName);

  await createRealMatchAndOpenConversation(
    sharer,
    sharerId,
    sharerName,
    partner,
    partnerId,
    partnerName,
  );

  const locationText = `Login location ${Date.now()}`;
  const url = await createRealDateShareLink(sharer, locationText);

  // `sharer` still holds its own real, valid refresh cookie — a real
  // logged-in user opening a real share link (their own, or anyone else's)
  // is the exact case FR-393/FR-395 exist for. A real full navigation
  // (matching how a link is actually opened in practice, e.g. from a chat
  // app), not an in-app client-side transition.
  await sharer.goto(url);
  await expect(sharer.getByRole("heading", { name: partnerName })).toBeVisible({
    timeout: 10_000,
  });
  await expect(sharer.getByText(locationText)).toBeVisible();
  await expect(sharer).not.toHaveURL(/\/login/);

  // The real session survives this detour — navigating back into the
  // authenticated app still works, proving no session was destroyed.
  await sharer.goto("/matches");
  await expect(sharer).not.toHaveURL(/\/login/);
  await expect(sharer.getByRole("link", { name: partnerName })).toBeVisible({
    timeout: 10_000,
  });

  await sharerContext.close();
  await partnerContext.close();
});

test("creating a link when the real partner is unverified, or has opted out, shows the real distinguishing backend detail text (409, FR-156/FR-173/FR-383)", async ({
  browser,
}) => {
  test.setTimeout(150_000);

  const sharerContext = await browser.newContext();
  const partnerContext = await browser.newContext();
  const sharer = await sharerContext.newPage();
  const partner = await partnerContext.newPage();

  const sharerName = "Verify user one";
  const partnerName = "Verify user two";
  const sharerId = await loginAndCompleteProfile(sharer, uniquePhone(), sharerName);
  const partnerId = await loginAndCompleteProfile(partner, uniquePhone(), partnerName);

  await createRealMatchAndOpenConversation(
    sharer,
    sharerId,
    sharerName,
    partner,
    partnerId,
    partnerName,
  );

  // Real precondition #1: the partner's own verification is flipped off
  // directly on their already-matched row (FR-166's own stated premise —
  // not reachable through the normal app flow, since Feature 6's
  // VERIFIED_ONLY default makes matching an unverified user unreachable in
  // the first place).
  await setUserFlag(partnerId, "livenessStatus", false);
  await sharer.getByRole("button", { name: "Share date" }).click();
  const yearOptionsA = await sharer
    .getByLabel("Date year (Persian calendar)")
    .locator("option")
    .allTextContents();
  await sharer
    .getByLabel("Date year (Persian calendar)")
    .selectOption(String(Math.max(...yearOptionsA.map(Number))));
  await sharer.getByPlaceholder("e.g. Café X, Main Street").fill("Unverified location");
  await sharer.getByRole("button", { name: "Create link" }).click();
  await expect(sharer.getByText("The other participant is not verified", { exact: false })).toBeVisible({
    timeout: 10_000,
  });

  // Restore verification, then flip the real opt-out flag instead — the
  // real, distinct 409 detail text for the *other* real precondition.
  await setUserFlag(partnerId, "livenessStatus", true);
  await setUserFlag(partnerId, "allowInSafetyShares", false);
  await sharer.getByPlaceholder("e.g. Café X, Main Street").fill("Opted-out location");
  await sharer.getByRole("button", { name: "Create link" }).click();
  await expect(
    sharer.getByText("The other participant has opted out", { exact: false }),
  ).toBeVisible({ timeout: 10_000 });

  // Restore the default so this test leaves no lasting state behind.
  await setUserFlag(partnerId, "allowInSafetyShares", true);

  await sharerContext.close();
  await partnerContext.close();
});
