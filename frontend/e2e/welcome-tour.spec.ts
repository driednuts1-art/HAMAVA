import { test, expect, type Page } from "@playwright/test";
import { uniquePhone, loginAndCompleteProfile } from "./helpers";

// Feature 29: a real, durable one-time flag (hasSeenWelcomeTour), not a
// live "just transitioned" event — see docs/requirements.md Feature 29 §2.

async function loginSeedAli(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Phone number").fill("+19005550001");
  await page.getByRole("button", { name: "Send code" }).click();
  const codeInput = page.getByLabel("Verification code");
  await expect(codeInput).toHaveValue(/^\d{6}$/, { timeout: 10_000 });
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL("http://localhost:3001/", { timeout: 10_000 });
}

test("a freshly-completed profile shows the real welcome tour (FR-505)", async ({
  page,
}) => {
  await loginAndCompleteProfile(page, uniquePhone(), "tour-fresh", { dismissWelcomeTour: false });

  await expect(page.getByRole("dialog", { name: "Welcome tour" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Welcome to Hamava!" }),
  ).toBeVisible();
});

test("an already-complete, already-seen seed user never sees it again (FR-502 backfill)", async ({
  page,
}) => {
  await loginSeedAli(page);

  await expect(page.getByRole("dialog", { name: "Welcome tour" })).not.toBeVisible();
});

test("Dismiss dismisses the tour immediately, and it stays dismissed after a reload (FR-507/508)", async ({
  page,
}) => {
  await loginAndCompleteProfile(page, uniquePhone(), "tour-dismiss", { dismissWelcomeTour: false });

  await expect(page.getByRole("dialog", { name: "Welcome tour" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome tour" })).not.toBeVisible();

  // FR-508: a real reload — this must be a durable, server-persisted
  // dismissal, not just in-memory store state that a fresh page load would
  // lose.
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Welcome tour" })).not.toBeVisible();
});

test("clicking Next through all 4 slides ends on Let's go!, which also dismisses for good (FR-506/507)", async ({
  page,
}) => {
  await loginAndCompleteProfile(page, uniquePhone(), "tour-complete", { dismissWelcomeTour: false });

  await expect(page.getByRole("dialog", { name: "Welcome tour" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("button", { name: "Let's go!" })).toBeVisible();
  await page.getByRole("button", { name: "Let's go!" }).click();

  await expect(page.getByRole("dialog", { name: "Welcome tour" })).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Welcome tour" })).not.toBeVisible();
});
