import { test, expect } from "@playwright/test";
import {
  uniquePhone,
  loginAndReachChoiceScreen,
  generateTestJpeg,
  saveProfileForm,
} from "./helpers";

// A real user bug report (docs/requirements.md Feature 29 §11): completing a
// profile with the photo upload as the FINAL step — not the last "Save"
// click — silently leaves the app stuck on the onboarding form. Root cause:
// useAuthStore's `profileCompleted`/`hasSeenWelcomeTour` (which every real
// consumer of "is this profile complete" actually reads — ProfilePage,
// (tabs)/layout.tsx's WelcomeTour/TabBar, and (tabs)/page.tsx's own
// discovery gate) were only ever synced from ProfileForm's and
// ConversationalSetup's own PATCH responses — never from PhotoGrid's
// independent upload, which can just as easily be the action that actually
// crosses the completion threshold.
//
// Deliberately does NOT use loginAndCompleteProfile() from helpers.ts: that
// shared helper always does a real page.reload() right after its own photo
// upload, which re-runs AuthRehydrator and happens to re-sync the store —
// exactly the manual-refresh workaround a real user doesn't know to do, and
// exactly what would mask this regression if this test relied on it.
test("a profile completed by the FINAL photo upload (not the last Save) reflects everywhere with zero manual reload (real regression guard)", async ({
  page,
}) => {
  const phone = uniquePhone();
  await loginAndReachChoiceScreen(page, phone);
  await page.getByRole("button", { name: "Manual form" }).click();

  const yearOptions = await page
    .getByLabel("Year of birth (Persian calendar)")
    .locator("option")
    .allTextContents();
  const youngestYear = Math.max(...yearOptions.map(Number));
  await page
    .getByLabel("Year of birth (Persian calendar)")
    .selectOption(String(youngestYear - 15));
  await page.getByLabel("Name").fill("Sync test");
  await page.getByLabel("Current city").fill("Toronto");

  // See helpers.ts's own note: the prompt label/option text below is real,
  // live data from the backend's own prompts.constants.ts — now English
  // since Phase 5.
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

  // Save now, deliberately BEFORE any photo — the real PATCH response must
  // still show an incomplete profile (no photo yet), matching the exact
  // order the original bug report described.
  await saveProfileForm(page);
  await expect(page.getByText(/age between/i)).not.toBeVisible();

  // The photo, uploaded LAST, is the real action that crosses the
  // completion threshold this time — not the "Save" click above.
  const fileInput = page.locator('input[type="file"]');
  const photoResponse = page.waitForResponse(
    (r) => r.url().endsWith("/v1/profile/photos") && r.request().method() === "POST",
  );
  await fileInput.setInputFiles({
    name: "profile.jpg",
    mimeType: "image/jpeg",
    buffer: await generateTestJpeg(page),
  });
  await photoResponse;
  await expect(page.getByText("Photo added.")).toBeVisible();

  // No page.reload() here — a real user never does one either. If the fix
  // works, useAuthStore is now in sync purely from this upload's own
  // effects, with no further user action.
  await expect(
    page.getByRole("dialog", { name: "Welcome tour" }),
  ).toBeVisible({ timeout: 10_000 });

  // The tab bar's own visibility (app/(tabs)/layout.tsx) is gated on the
  // exact same store field — a second, independent real consumer, not just
  // the tour.
  await expect(page.getByRole("link", { name: "Profile" })).toBeVisible();

  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(
    page.getByRole("dialog", { name: "Welcome tour" }),
  ).not.toBeVisible();

  // Third real consumer: app/(tabs)/page.tsx's own discovery gate
  // (`if (!user.profileCompleted) return <blank div>`), reached here via a
  // real client-side <Link> navigation — not page.goto()/reload(), which
  // would trigger AuthRehydrator and mask the exact bug this test exists to
  // catch.
  await page.getByRole("link", { name: "Discover" }).click();
  await expect(page).toHaveURL("http://localhost:3001/");
  await expect(page.getByRole("button", { name: "Filters" })).toBeVisible({
    timeout: 10_000,
  });
});
