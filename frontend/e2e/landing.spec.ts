import { test, expect, type Page } from "@playwright/test";

// Feature 28: "/" is now dual-purpose — a real public landing page for a
// logged-out visitor, the existing discovery screen for an authenticated
// one. Uses a real, already-verified, already-complete seed user
// (docs/test-users.md — Ali Rezaei) for the authenticated case, not a fresh
// signup, since this test only needs to prove routing behavior and has no
// reason to depend on real OpenAI moderation at all.
async function loginSeedAli(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Phone number").fill("+19005550001");
  await page.getByRole("button", { name: "Send code" }).click();
  const codeInput = page.getByLabel("Verification code");
  await expect(codeInput).toHaveValue(/^\d{6}$/, { timeout: 10_000 });
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL("http://localhost:3001/", { timeout: 10_000 });
}

test("a logged-out visitor sees the real landing page at / (FR-495), not a redirect to /login", async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.goto("/");

  await expect(page).toHaveURL("http://localhost:3001/");
  await expect(
    page.getByRole("heading", { name: "Every profile, a real person" }),
  ).toBeVisible();
});

test("the landing page's Get started button navigates to /login (FR-499)", async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.goto("/");

  await page.getByRole("link", { name: "Get started" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Phone number")).toBeVisible();
});

test("the two legal pages and the help center are reachable from the landing page footer without logging in (FR-497)", async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.goto("/");

  await page.getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page).toHaveURL(/\/settings\/privacy-policy$/);
  // getByRole("heading", ...), not getByText: the page's own <h1> and the
  // reused LegalLinksRow's own link both now read the identical English
  // "Privacy Policy" — a real, English-specific ambiguity that didn't exist
  // in Persian (the page heading and the settings link used to be two
  // distinct phrasings, "سیاست حریم خصوصی" vs "حریم خصوصی"). Scoping to the
  // heading role disambiguates, matching Playwright's own best practice
  // rather than reintroducing an artificial wording difference.
  await expect(
    page.getByRole("heading", { name: "Privacy Policy" }),
  ).toBeVisible();

  await page.goto("/settings/terms");
  await expect(page).toHaveURL(/\/settings\/terms$/);
  // Same heading/paragraph ambiguity as Privacy Policy above.
  await expect(
    page.getByRole("heading", { name: "Terms of Service" }),
  ).toBeVisible();

  await page.goto("/settings/help");
  await expect(page).toHaveURL(/\/settings\/help$/);
  await expect(page.getByRole("heading", { name: "Help Center" })).toBeVisible();
});

test("an authenticated visitor's / still shows discovery, not the landing page (FR-496)", async ({
  page,
}) => {
  await loginSeedAli(page);

  // The real discovery-screen affordance, not the landing page's own hero.
  await expect(page.getByRole("button", { name: "Filters" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Every profile, a real person" }),
  ).not.toBeVisible();

  // FR-497b: a hard reload of / must not disturb the real session either.
  await page.reload();
  await expect(page.getByRole("button", { name: "Filters" })).toBeVisible();
});

test("an authenticated visitor hard-reloading the legal/help pages keeps their real session (FR-497b)", async ({
  page,
}) => {
  await loginSeedAli(page);

  const pagesAndHeadings: [string, string][] = [
    ["/settings/privacy-policy", "Privacy Policy"],
    ["/settings/terms", "Terms of Service"],
    ["/settings/help", "Help Center"],
  ];

  for (const [path, heading] of pagesAndHeadings) {
    await page.goto(path);
    // getByRole("heading", ...): the privacy-policy and terms pages each
    // render the same English phrase twice — once as the page's own <h1>
    // (SettingsSubHeader) and once as ComingSoonPlaceholder's title — a real
    // ambiguity that didn't exist in Persian (see the identical fix above).
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    // A real hard reload — the actual scenario FR-497b guards against.
    // Waited out fully (not chased immediately by another navigation) so
    // this reload's own real refresh-token rotation genuinely settles
    // first — this project's own already-documented single-use-rotation
    // race (docs/roadmap.md) is real under back-to-back raw navigations,
    // not something this test should trip over by being impatient.
    await page.reload();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    // Still authenticated: the settings-only back icon (aria-label,
    // SettingsSubHeader) is present — it would 404/redirect nowhere useful
    // if the session had been silently cleared by the reload.
    await expect(
      page.getByRole("link", { name: "Back to Settings" }).first(),
    ).toBeVisible();
  }
});
