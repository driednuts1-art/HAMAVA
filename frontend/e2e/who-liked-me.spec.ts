import { test, expect, type Page } from "@playwright/test";
import {
  uniquePhone,
  loginAndCompleteProfile,
  saveProfileForm,
  gotoResilient,
} from "./helpers";

// Feature 24 §6.5 (FR-456..461) — real backend throughout (FR-255's
// standing rule). Reuses discovery.spec.ts's own forceDeckTarget technique
// (mocks only which candidate the *deck* shows first, so a controlled,
// deterministic real swipe can be fired) — GET /v1/discovery/who-liked-me
// itself is never mocked in these tests, since that real, unmocked
// response is exactly what FR-453..457 and FR-459 are about.

const BACKEND_URL = "http://localhost:3000";

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
            age: 33,
            city: "Toronto",
            bio: null,
            interests: [],
            verified: true,
            photos: [],
            // Feature 24: CandidateCard now unconditionally reads these —
            // a real bug found running this suite (an outdated mock literal
            // missing them crashed the whole page with a real, uncaught
            // TypeError — the real "This page couldn't load" this test was
            // actually hitting, not a resource/flakiness issue as first
            // suspected). The real backend always includes them via
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

async function accessToken(page: Page): Promise<string> {
  const res = await page.request.post("/api/auth/refresh");
  return ((await res.json()) as { accessToken: string }).accessToken;
}

test("profile-depth renders on a real Who Liked Me card, hideDrinkingSmoking hides it from a second real user, and match-back produces a real Match while the liker disappears (FR-453..461)", async ({
  browser,
}) => {
  test.setTimeout(150_000); // 2 full real logins/profile completions + several real round trips.

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const userIdA = await loginAndCompleteProfile(pageA, uniquePhone(), "User A");
  const userIdB = await loginAndCompleteProfile(pageB, uniquePhone(), "User B");

  // A fills real about-me fields — this, plus the 2 real prompt answers
  // loginAndCompleteProfile already set ("My best night is when…" → "A
  // simple answer."), is exactly what B's Who Liked Me card must render.
  await gotoResilient(pageA, "/profile");
  // Feature 25: a complete profile opens on view mode by default now —
  // "Edit Profile" reaches the real edit form this test needs.
  await pageA.getByRole("button", { name: "Edit Profile" }).click();
  await pageA.getByLabel("Hometown").fill("Shiraz");
  await pageA.getByLabel("Education").selectOption({ label: "Bachelor's" });
  // exact: true — see profile-depth.spec.ts's identical note: "Drinking" is
  // a real substring of the "Hide drinking and smoking..." checkbox's own
  // aria-label, both correct and distinct for real assistive tech.
  await pageA.getByLabel("Drinking", { exact: true }).selectOption({ label: "Sometimes" });
  await saveProfileForm(pageA);

  // A likes B (one-sided, real POST /v1/discovery/swipes with a real
  // targetUserId — only the deck *listing* is forced, matching
  // discovery.spec.ts's own established technique).
  await forceDeckTarget(pageA, userIdB, "User B");
  await gotoResilient(pageA, "/");
  const likeButton = pageA.getByRole("button", { name: "Like", exact: true });
  await expect(likeButton).toBeVisible({ timeout: 10_000 });
  await likeButton.click();

  // B's own real, unmocked Who Liked Me list must show A with the real
  // profile-depth fields rendered (FR-453).
  await gotoResilient(pageB, "/liked");
  await expect(pageB.getByText("User A")).toBeVisible({ timeout: 10_000 });
  await expect(pageB.getByText("My best night is when…")).toBeVisible();
  await expect(pageB.getByText("A simple answer.")).toBeVisible();
  await expect(pageB.getByText("Lives in Toronto · From Shiraz")).toBeVisible();
  await expect(pageB.getByText("Bachelor's")).toBeVisible();
  // FR-451: hideDrinkingSmoking is false — the real value must be visible.
  await expect(pageB.getByText("Drinking: Sometimes")).toBeVisible();

  // FR-451: A now hides the category — the *entire* category, not just an
  // empty value swapped in.
  await gotoResilient(pageA, "/profile");
  // Feature 25: same as above — view mode by default, edit form behind
  // "Edit Profile".
  await pageA.getByRole("button", { name: "Edit Profile" }).click();
  await pageA.getByLabel("Hide drinking and smoking from my profile").check();
  await saveProfileForm(pageA);

  // A fresh reload on B's side — a real re-fetch, not a stale cache read.
  await pageB.reload();
  await expect(pageB.getByText("User A")).toBeVisible({ timeout: 10_000 });
  await expect(pageB.getByText("Drinking: Sometimes")).not.toBeVisible();
  // Everything else A set stays visible — the hide is scoped to
  // drinking/smoking only, not a blanket suppression of A's other fields.
  await expect(pageB.getByText("Bachelor's")).toBeVisible();

  // FR-458: match-back shows the existing MatchConfirmation (Feature 16),
  // not Feature 17's reserved MatchMoment, and stays on this same list.
  await pageB.getByRole("button", { name: "Like back" }).click();
  await expect(pageB.getByText("It's a match!")).toBeVisible({ timeout: 10_000 });
  await expect(pageB).toHaveURL(/\/liked$/);
  await pageB.getByRole("button", { name: "OK" }).click();
  await expect(pageB.getByText("It's a match!")).not.toBeVisible();

  // A no longer belongs in "not yet swiped back."
  await expect(pageB.getByText("User A")).not.toBeVisible();

  // FR-458's real match claim, checked on both sides via the real
  // GET /v1/discovery/matches — not a client-side "matched: true" assumption.
  const tokenA = await accessToken(pageA);
  const tokenB = await accessToken(pageB);
  const matchesA = await pageA.request.get(`${BACKEND_URL}/v1/discovery/matches`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const matchesB = await pageB.request.get(`${BACKEND_URL}/v1/discovery/matches`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  const matchListA = (await matchesA.json()) as { user: { id: string } }[];
  const matchListB = (await matchesB.json()) as { user: { id: string } }[];
  expect(matchListA.some((m) => m.user.id === userIdB)).toBe(true);
  expect(matchListB.some((m) => m.user.id === userIdA)).toBe(true);

  await contextA.close();
  await contextB.close();
});

test("a real dismiss (PASS) from Who Liked Me is permanent — the candidate never reappears, even after a fresh reload (FR-459)", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const userIdA = await loginAndCompleteProfile(pageA, uniquePhone(), "Pass user");
  const userIdB = await loginAndCompleteProfile(pageB, uniquePhone(), "Receiver user");

  await forceDeckTarget(pageA, userIdB, "Receiver user");
  await gotoResilient(pageA, "/");
  const likeButton = pageA.getByRole("button", { name: "Like", exact: true });
  await expect(likeButton).toBeVisible({ timeout: 10_000 });
  await likeButton.click();

  await gotoResilient(pageB, "/liked");
  await expect(pageB.getByText("Pass user")).toBeVisible({ timeout: 10_000 });

  await pageB.getByRole("button", { name: "Pass" }).click();
  await expect(pageB.getByText("Pass user")).not.toBeVisible({ timeout: 10_000 });
  // No confirmation dialog for a dismiss — nothing to close.
  await expect(pageB.getByText("It's a match!")).not.toBeVisible();

  // Permanence, from a genuinely fresh load — not just the same client cache.
  await pageB.reload();
  await expect(pageB.getByText("No one has liked you yet")).toBeVisible({
    timeout: 10_000,
  });
  await expect(pageB.getByText("Pass user")).not.toBeVisible();

  // Confirmed via the real backend directly too — a real PASS row, not a
  // match, and userIdA genuinely excluded from userIdB's real who-liked-me.
  const tokenB = await accessToken(pageB);
  const whoLikedMe = await pageB.request.get(
    `${BACKEND_URL}/v1/discovery/who-liked-me`,
    { headers: { Authorization: `Bearer ${tokenB}` } },
  );
  const body = (await whoLikedMe.json()) as { candidates: { id: string }[] };
  expect(body.candidates.some((c) => c.id === userIdA)).toBe(false);

  await contextA.close();
  await contextB.close();
});
