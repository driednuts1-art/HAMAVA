import { test, expect, type Page } from "@playwright/test";
import { uniquePhone, loginAndCompleteProfile } from "./helpers";

// Feature 20 (Settings) — real backend, real Postgres.

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
  // Widened from 10_000 after a real, measured failure (not a guess): a
  // Playwright trace from this exact assertion failing twice, at this exact
  // line, showed the sharer's GET /v1/chat/conversations call (which
  // MatchList's data depends on — see that component's own comment on why
  // /chat/conversations, not /discovery/matches, is the visibility
  // authority) taking a real 5,645ms round trip to the remote Neon database.
  // Consistent with the already-documented "Neon connection/cold-start
  // latency degrading under load" pattern (docs/roadmap.md, "Watch items",
  // the Feature 4/10 comparison and the dedicated 6th-occurrence entry for
  // this exact investigation) — not an application bug, so the fix here is
  // a timeout matching this file's own already-generous per-test budgets
  // (90_000/150_000 test.setTimeout), not a code change.
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  await sharer.getByRole("dialog", { name: "You matched" }).click();
}

test("a real settings toggle change persists across a real page reload (FR-405..410)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginAndCompleteProfile(page, uniquePhone(), "Settings user one");

  await page.goto("/settings");
  const locationToggle = page.getByLabel("Precise location");
  await expect(locationToggle).toBeVisible({ timeout: 10_000 });
  const before = await locationToggle.isChecked();

  await locationToggle.click();
  await expect(locationToggle).toBeChecked({ checked: !before });

  await page.reload();
  await expect(page.getByLabel("Precise location")).toBeChecked({
    checked: !before,
    timeout: 10_000,
  });
});

test("a real logout clears the session — a subsequent visit to a protected route redirects to /login (FR-411/412)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginAndCompleteProfile(page, uniquePhone(), "Logout user");

  await page.goto("/settings");
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("button", { name: "Yes, log out" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

  await page.goto("/matches");
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

test("a real, full account-deletion flow really and permanently deletes the account — the same phone number gets a brand-new id afterward (FR-413..420)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const phone = uniquePhone();
  await loginAndCompleteProfile(page, phone, "Delete user");

  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("button", { name: "I understand, continue" }).click();

  await page
    .getByLabel("Phone number to confirm account deletion")
    .fill(phone);
  // AUTH_OTP_DEBUG_ECHO isn't wired into DeleteAccountFlow's own UI (unlike
  // the login flow's OtpStep, which auto-fills from `initialDevCode`) — read
  // the real devCode directly off the real /v1/auth/otp/request response
  // this click triggers, matching FR-415's real, unchanged endpoint.
  const requestResponsePromise = page.waitForResponse((r) =>
    r.url().includes("/otp/request"),
  );
  await page.getByRole("button", { name: "Send code" }).click();
  const requestResponse = await requestResponsePromise;
  const { devCode } = (await requestResponse.json()) as { devCode?: string };
  if (!devCode) {
    throw new Error(
      "AUTH_OTP_DEBUG_ECHO devCode missing from /v1/auth/otp/request response — is the backend running with AUTH_OTP_DEBUG_ECHO=true?",
    );
  }

  const codeInput = page.getByLabel("Account deletion confirmation code");
  await expect(codeInput).toBeVisible({ timeout: 10_000 });
  await codeInput.fill(devCode);

  await page.getByRole("button", { name: "Permanently delete account" }).click();
  // FR-419: a real, distinct "account deleted" message on /login — not the
  // plain unexplained screen.
  await expect(
    page.getByText("Your account has been permanently deleted."),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).toHaveURL(/accountDeleted=1/);

  // The real backend acceptance criterion (Feature 6 FR-83..86), now
  // checked end-to-end through the real UI: the same phone number logs in
  // fresh and gets a genuinely new account, not the deleted one.
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Verification code")).toHaveValue(/^\d{6}$/, {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Live identity verification")).toBeVisible({ timeout: 10_000 });
});

test("a real unexpected 500 during account deletion shows a generic message, never the raw backend detail — and never deletes the account (FR-413..420)", async ({
  page,
}) => {
  // A real bug found live in components/auth/otp-step.tsx, then found to
  // recur at 7 more sites once actually searched for (docs/roadmap.md) —
  // delete-account-flow.tsx's own two mutations were among them, and
  // arguably the most consequential: deletion is irreversible, so a
  // confusing raw-English error message here is worse than almost anywhere
  // else in this app. This test covers the delete-confirm step specifically
  // (the one that actually deletes, not the OTP-request step before it).
  test.setTimeout(120_000);
  const phone = uniquePhone();
  await loginAndCompleteProfile(page, phone, "Delete user aborted");

  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("button", { name: "I understand, continue" }).click();
  await page.getByLabel("Phone number to confirm account deletion").fill(phone);

  const requestResponsePromise = page.waitForResponse((r) =>
    r.url().includes("/otp/request"),
  );
  await page.getByRole("button", { name: "Send code" }).click();
  const { devCode } = (await (await requestResponsePromise).json()) as {
    devCode?: string;
  };
  if (!devCode) {
    throw new Error("AUTH_OTP_DEBUG_ECHO devCode missing — is the backend running with it enabled?");
  }
  const codeInput = page.getByLabel("Account deletion confirmation code");
  await expect(codeInput).toBeVisible({ timeout: 10_000 });
  await codeInput.fill(devCode);

  // A real, honestly-labeled network-level simulation of a genuine backend
  // 500 — the real code is genuinely valid (just proven by devCode above),
  // so any confusion here can only come from how the *response* is shown,
  // not from a real wrong-code condition.
  await page.route("**/v1/users/me", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "An unexpected error occurred.",
        instance: "/v1/users/me",
      }),
    }),
  );

  await page.getByRole("button", { name: "Permanently delete account" }).click();

  await expect(
    page.getByText("That code is incorrect or has expired. Try again."),
  ).not.toBeVisible();
  // exact: true is required now that the safe fallback's own English detail
  // ("An unexpected error occurred. Please try again.",
  // lib/safe-error-message.ts's DEFAULT_FALLBACK, the only part
  // delete-account-flow.tsx actually renders — it never shows `.title`)
  // starts with the very same words as the raw backend text this checks is
  // never shown — see login.spec.ts's identical fix for the same reasoning.
  await expect(
    page.getByText("An unexpected error occurred.", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByText("An unexpected error occurred. Please try again."),
  ).toBeVisible();
  // Still on the code step, not navigated away — the deletion did not
  // proceed (the real DELETE call was intercepted before ever reaching the
  // real backend, so this also directly proves the account survives).
  await expect(page).not.toHaveURL(/accountDeleted=1/);
  await expect(codeInput).toBeVisible();
});

test("the real allowInSafetyShares toggle actually gates real Share My Date link creation (FR-407, closing Feature 19 Open Items #2)", async ({
  browser,
}) => {
  test.setTimeout(150_000);

  const sharerContext = await browser.newContext();
  const partnerContext = await browser.newContext();
  const sharer = await sharerContext.newPage();
  const partner = await partnerContext.newPage();

  const sharerName = "Gate user one";
  const partnerName = "Gate user two";
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

  // The partner (target of the share) turns their own real toggle off via
  // the real Settings UI — not a direct DB write, proving this feature's
  // own UI is what's wired to the real field.
  await partner.goto("/settings");
  const shareToggle = partner.getByLabel("Show up in date-share links");
  await expect(shareToggle).toBeChecked({ timeout: 10_000 });
  await shareToggle.click();
  await expect(shareToggle).not.toBeChecked();

  await sharer.getByRole("button", { name: "Share date" }).click();
  const yearOptions = await sharer
    .getByLabel("Date year (Persian calendar)")
    .locator("option")
    .allTextContents();
  await sharer
    .getByLabel("Date year (Persian calendar)")
    .selectOption(String(Math.max(...yearOptions.map(Number))));
  await sharer.getByPlaceholder("e.g. Café X, Main Street").fill("Gated location");
  await sharer.getByRole("button", { name: "Create link" }).click();
  await expect(
    sharer.getByText("opted out of appearing in Share My Date links", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 10_000 });

  // Toggling it back on immediately allows creation to succeed for the
  // same pair.
  await partner.reload();
  const shareToggleAfterReload = partner.getByLabel(
    "Show up in date-share links",
  );
  await expect(shareToggleAfterReload).not.toBeChecked({ timeout: 10_000 });
  await shareToggleAfterReload.click();
  await expect(shareToggleAfterReload).toBeChecked();

  await sharer.getByRole("button", { name: "Create link" }).click();
  await expect(sharer.locator("text=/http:\\/\\/localhost:3001\\/date\\//")).toBeVisible({
    timeout: 10_000,
  });

  await sharerContext.close();
  await partnerContext.close();
});

// Feature 22 — Settings depth (docs/requirements.md Feature 22 §6.1..6.4).
test("Settings shows the three new rows, each real sub-route renders and links back, and the FAQ accordion really expands/collapses (FR-308..317)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginAndCompleteProfile(page, uniquePhone(), "Settings depth user");

  await page.goto("/settings");
  // Widened from the default 5s alongside the allowInSafetyShares test above
  // (same file, same investigation): this test failed once at this general
  // shape (a real backend-dependent render right after a fresh login/profile
  // completion) in the same regression pass that produced the measured
  // 5,645ms Neon round-trip documented there and in docs/roadmap.md's Watch
  // items — same generous-timeout treatment, not a code change.
  await expect(page.getByRole("heading", { name: "Support & Safety" })).toBeVisible({
    timeout: 30_000,
  });
  const helpLink = page.getByRole("link", { name: "Help Center" });
  const safetyLink = page.getByRole("link", { name: "Safety" });
  const privacyLink = page.getByRole("link", { name: "Privacy Policy" });
  const termsLink = page.getByRole("link", { name: "Terms of Service" });
  await expect(helpLink).toBeVisible();
  await expect(safetyLink).toBeVisible();
  await expect(privacyLink).toBeVisible();
  await expect(termsLink).toBeVisible();

  // Help Center: real route, real FAQ accordion — collapsed by default,
  // expands and collapses on a real click (FR-310).
  await helpLink.click();
  await expect(page).toHaveURL(/\/settings\/help/);
  const faqQuestion = page.getByRole("button", {
    name: "How does AI Search work?",
  });
  await expect(faqQuestion).toHaveAttribute("aria-expanded", "false");
  const faqAnswer = page.getByText(
    "Just describe who you're looking for, by text or voice",
  );
  await expect(faqAnswer).not.toBeVisible();
  await faqQuestion.click();
  await expect(faqQuestion).toHaveAttribute("aria-expanded", "true");
  await expect(faqAnswer).toBeVisible();
  await faqQuestion.click();
  await expect(faqQuestion).toHaveAttribute("aria-expanded", "false");
  await expect(faqAnswer).not.toBeVisible();
  await page.getByRole("link", { name: "Back to Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);

  // Safety & Security: real route, real content, and the honest,
  // explicit blocked-list gap acknowledgment (FR-317).
  await safetyLink.click();
  await expect(page).toHaveURL(/\/settings\/safety/);
  await expect(
    page.getByText("Meet your first date in a public place"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "You currently can't view or manage your blocked-users list from Settings",
    ),
  ).toBeVisible();
  await page.goBack();

  // Privacy Policy / Terms: both real placeholder routes, not a 404 or a
  // broken link (FR-313).
  await privacyLink.click();
  await expect(page).toHaveURL(/\/settings\/privacy-policy/);
  await expect(
    page.getByText("The official text of this document isn't ready yet"),
  ).toBeVisible();
  await page.goBack();

  await termsLink.click();
  await expect(page).toHaveURL(/\/settings\/terms/);
  await expect(
    page.getByText("The official text of this document isn't ready yet"),
  ).toBeVisible();
});
