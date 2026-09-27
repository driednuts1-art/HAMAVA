import { expect, type Page } from "@playwright/test";

// FR-223 (Feature 14), reused by Feature 15's own e2e suite — a single
// shared source for these, not a second hand-rolled copy per test file.
export function uniquePhone(): string {
  return `+1555${Date.now().toString().slice(-7)}`;
}

/**
 * Real phone→OTP flow, stopping right at the liveness consent screen —
 * matches Feature 14's own `login.spec.ts` tests, several of which need to
 * do their own thing between "reached liveness" and "accepted it."
 */
export async function loginToLivenessStep(
  page: Page,
  phone: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  const codeInput = page.getByLabel("Verification code");
  await expect(codeInput).toHaveValue(/^\d{6}$/, { timeout: 10_000 });
  await page.getByRole("button", { name: "Verify" }).click();
  // Real, honest finding while adding Feature 24's own multi-user e2e
  // coverage: the default 5s timeout is genuinely too tight for this step
  // under real system memory pressure (a resource-constrained dev machine
  // running several concurrent real browser contexts) — the backend itself
  // always completed the real OTP verify + auto-liveness-pass instantly
  // (confirmed directly from its own logs), so a slow *render*, not a slow
  // backend, is what a short timeout here was actually failing on.
  await expect(page.getByText("Live identity verification")).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Full real login through liveness, landing on Feature 15's choice screen.
 * Feature 16 moved the choice screen from "/" (now the discovery screen) to
 * "/profile" — login still lands at "/" first, and "/" itself redirects an
 * incomplete profile straight to "/profile" (app/page.tsx's own gate).
 */
export async function loginAndReachChoiceScreen(
  page: Page,
  phone: string,
): Promise<void> {
  await loginToLivenessStep(page, phone);
  await page.getByRole("button", { name: "I agree, continue" }).click();
  await expect(page).toHaveURL("http://localhost:3001/profile", { timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: "Let's build your profile" }),
  ).toBeVisible();
}

/**
 * Clicks ProfileForm's "Save" and waits for the real PATCH /v1/profile
 * response to resolve — a real bug found running this suite (after Feature
 * 24 added more fields to this same form): the save button's own
 * `disabled={mutation.isPending || ...}` goes disabled *immediately* on
 * click, synchronously, well before the network round trip finishes — so
 * `expect(saveButton).toBeDisabled()` right after a click is a false-positive
 * "it's done" signal (it's just as true while merely pending). A caller
 * needing the *next* step to see this save's real, committed effect (e.g.
 * completeness math depending on a field this save just set) must wait for
 * the actual response, not the button's transient pending-disabled state.
 */
export async function saveProfileForm(page: Page): Promise<void> {
  const patchResponse = page.waitForResponse(
    (r) => r.url().endsWith("/v1/profile") && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save" }).click();
  await patchResponse;
}

/**
 * A real, honest finding while adding Feature 24's own multi-context e2e
 * coverage: on this dev machine, under genuine memory pressure from running
 * several concurrent real browser contexts (confirmed directly — 2GB free
 * of 8GB total — not a guess), `page.goto()` occasionally lands on
 * Chromium's own transient network-error interstitial ("This page couldn't
 * load") instead of the real app, even though the frontend/backend
 * themselves respond instantly to a direct check run at the same moment.
 * One retry clears it every time it's been seen — a real, pragmatic
 * response to genuine local resource contention, not a hidden app bug.
 */
export async function gotoResilient(page: Page, url: string): Promise<void> {
  await page.goto(url);
  // Matched by substring, deliberately avoiding the apostrophe entirely — a
  // real bug caught writing this very check: Chromium's real interstitial
  // renders a curly "’" (U+2019), not a straight "'", so an exact-text
  // match against the straight character silently never matched at all,
  // making the very first version of this helper a complete no-op.
  const isErrorPage = await page
    .getByRole("heading", { name: /This page couldn.t load/ })
    .isVisible()
    .catch(() => false);
  if (isErrorPage) {
    await page.goto(url);
  }
}

/** A real, valid, decodable JPEG generated at test time (no repo fixture exists). */
export async function generateTestJpeg(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#2fbeb5";
    ctx.fillRect(0, 0, 64, 64);
    return canvas.toDataURL("image/jpeg");
  });
  const base64 = dataUrl.split(",")[1];
  return Buffer.from(base64, "base64");
}

/**
 * Full real login through liveness AND a complete manual profile (FR-227),
 * landing on "/" as a verified, discovery-eligible user. Returns the real
 * database id (captured off the real POST /api/auth/verify response, the
 * only place the browser ever sees it — Feature 16's own e2e tests need it
 * to force a deterministic swipe target, since the deck's real
 * oldest-createdAt-first ordering [deck.service.ts] can't be relied on to
 * surface a just-created counterpart within the first page).
 */
export async function loginAndCompleteProfile(
  page: Page,
  phone: string,
  displayName: string,
  // Feature 29: defaults to true for every caller that just wants a clean,
  // completed, interactable profile (matches deck.spec.ts/discovery.spec.ts's
  // own real use of this helper) — welcome-tour.spec.ts explicitly passes
  // false, since it needs the real tour still showing right after this
  // helper returns, not dismissed on its behalf.
  { dismissWelcomeTour = true }: { dismissWelcomeTour?: boolean } = {},
): Promise<string> {
  const verifyResponsePromise = page.waitForResponse(
    (r) => r.url().endsWith("/api/auth/verify") && r.request().method() === "POST",
  );
  await loginAndReachChoiceScreen(page, phone);
  const verifyBody = (await (await verifyResponsePromise).json()) as {
    user: { id: string };
  };

  await page.getByRole("button", { name: "Manual form" }).click();

  const yearOptions = await page
    .getByLabel("Year of birth (Persian calendar)")
    .locator("option")
    .allTextContents();
  const youngestYear = Math.max(...yearOptions.map(Number));
  await page
    .getByLabel("Year of birth (Persian calendar)")
    .selectOption(String(youngestYear - 15));
  await page.getByLabel("Name").fill(displayName);
  await page.getByLabel("Current city").fill("Toronto");

  // Feature 24 (FR-435): profile completeness now also requires 2 real
  // prompt answers, alongside displayName/birthDate/photo — every caller of
  // this shared helper needs a genuinely complete profile, so this real
  // requirement is filled in here once rather than in each test.
  //
  // NOTE: the prompt label/option text below is real, live data from the
  // backend's own prompts.constants.ts (GET /v1/profile/prompts) — now
  // English since Phase 5 (docs/i18n-rtl-migration-scope.md §9) translated
  // the backend prompt list. Matching it here exactly, not guessed.
  await page
    .getByLabel("Add a new prompt")
    .selectOption({ label: "My best night is when…" });
  await page.getByRole("button", { name: "Add prompt" }).click();
  await page.getByLabel("My best night is when…").fill("A simple answer.");
  await page
    .getByLabel("Add a new prompt")
    .selectOption({ label: "A weird thing about me…" });
  await page.getByRole("button", { name: "Add prompt" }).click();
  await page.getByLabel("A weird thing about me…").fill("A weird answer.");

  // A real wait for the actual PATCH round trip (see saveProfileForm's own
  // doc comment) — without it, the photo upload below could fire its own
  // completeness check before this PATCH (carrying
  // displayName/birthDate/promptAnswers) has actually committed, leaving
  // `profileCompletedAt` permanently unset even once every real
  // requirement is in fact met — a genuine race found running this suite.
  await saveProfileForm(page);
  await expect(page.getByText(/age between/i)).not.toBeVisible();

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "profile.jpg",
    mimeType: "image/jpeg",
    buffer: await generateTestJpeg(page),
  });
  await expect(page.locator("img[alt='']")).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByRole("heading", { name: "My Profile" })).toBeVisible({
    timeout: 10_000,
  });

  // Feature 29: this is exactly the moment profileCompleted first flips
  // true, so the real welcome-tour overlay now genuinely appears here for
  // every caller of this shared helper — a real regression found running
  // Feature 25's own existing e2e suite after Feature 29 shipped, not
  // assumed away. Dismissed once, centrally, rather than patched into each
  // of this helper's many callers separately (the same
  // fix-it-once-in-the-shared-helper precedent already used for
  // uniquePhone()/rejectVendorUnavailable()) — except for the one real
  // caller (welcome-tour.spec.ts) that explicitly needs the tour left alone.
  if (dismissWelcomeTour) {
    const dismissTour = page.getByRole("button", { name: "Dismiss" });
    if (await dismissTour.isVisible().catch(() => false)) {
      await dismissTour.click();
      await expect(
        page.getByRole("dialog", { name: "Welcome tour" }),
      ).not.toBeVisible();
    }
  }

  return verifyBody.user.id;
}
