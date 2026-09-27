import { test, expect } from "@playwright/test";
import {
  uniquePhone,
  loginAndReachChoiceScreen,
  generateTestJpeg,
  loginAndCompleteProfile,
  saveProfileForm,
} from "./helpers";

// Feature 24 (FR-432..FR-451) — real backend throughout (FR-255's standing
// rule), same posture as every other e2e file in this suite.

const BACKEND_URL = "http://localhost:3000";

test("about-me/hometown/languages/drinking fields and a 3rd prompt answer persist through a real reload, alongside the 2 loginAndCompleteProfile already set (FR-434..451)", async ({
  page,
}) => {
  // helpers.ts's loginAndCompleteProfile now fills 2 real prompt answers
  // itself (FR-435 — every caller needs a genuinely complete profile) —
  // this test adds the 3rd (MAX_ANSWERS cap) and the about-me fields,
  // and confirms all of it (the 2 pre-existing answers included) survives
  // a real reload, not just what this test itself just wrote.
  const phone = uniquePhone();
  await loginAndCompleteProfile(page, phone, "Depth user");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "My Profile" })).toBeVisible({
    timeout: 10_000,
  });
  // Feature 25: a complete profile now opens on the real view mode
  // (CandidateCard) by default — "Edit Profile" reaches the actual edit
  // form this test needs.
  await page.getByRole("button", { name: "Edit Profile" }).click();

  // NOTE: the prompt label/option text below is real, live data from the
  // backend's own prompts.constants.ts — now English since Phase 5 (see
  // helpers.ts's identical note).
  await page
    .getByLabel("Add a new prompt")
    .selectOption({ label: "A perfect Sunday for me is…" });
  await page.getByRole("button", { name: "Add prompt" }).click();
  await page
    .getByLabel("A perfect Sunday for me is…")
    .fill("A long walk and a cup of coffee.");

  // FR-439/440/444/448/451.
  await page.getByLabel("Hometown").fill("Shiraz");
  await page.getByLabel("Education").selectOption({ label: "Bachelor's" });
  await page.getByRole("button", { name: "Persian" }).click();
  await page.getByRole("button", { name: "German" }).click();
  // exact: true — a real, newly-found substring collision: "Drinking" is a
  // substring of the "Hide drinking and smoking from my profile" checkbox's
  // own aria-label. Both real labels are correct and distinct for actual
  // assistive tech (which matches exact accessible names, not substrings);
  // this is a Playwright default-matching pitfall, same category as this
  // project's other documented substring collisions — fixed at the
  // selector, not by changing correct, already-shipped UI copy.
  await page.getByLabel("Drinking", { exact: true }).selectOption({ label: "Sometimes" });

  await saveProfileForm(page); // FR-232: a real, awaited PATCH round trip.

  // FR-434's own real persistence claim: reload from scratch, re-fetching
  // GET /v1/profile/me — nothing here comes from client-side memory.
  await page.reload();
  // Feature 25: the reload lands on view mode (a complete profile's real
  // default) — back into the edit form to check the persisted field
  // *values* directly, which view mode doesn't expose as raw form values.
  await expect(page.getByRole("heading", { name: "My Profile" })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Edit Profile" }).click();
  // The 2 answers loginAndCompleteProfile itself set — proving a partial
  // update (this test's own PATCH) never clobbered them.
  await expect(page.getByLabel("My best night is when…")).toHaveValue(
    "A simple answer.",
    { timeout: 10_000 },
  );
  await expect(page.getByLabel("A weird thing about me…")).toHaveValue(
    "A weird answer.",
  );
  // This test's own 3rd answer.
  await expect(page.getByLabel("A perfect Sunday for me is…")).toHaveValue(
    "A long walk and a cup of coffee.",
  );
  await expect(page.getByLabel("Hometown")).toHaveValue("Shiraz");
  await expect(page.getByLabel("Education")).toHaveValue("BACHELORS");
  await expect(page.getByRole("button", { name: "Persian" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "German" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("Drinking", { exact: true })).toHaveValue("SOMETIMES");
});

test("profile completeness requires 2 real prompt answers, confirmed via a real GET /v1/profile/me (FR-435)", async ({
  page,
}) => {
  // Deliberately not loginAndCompleteProfile here — that helper now
  // guarantees a complete profile (it has to, for every *other* e2e test
  // that depends on it), which would defeat this test's own claim. Its own
  // minimal manual flow, without any prompt answers, is built directly.
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
  await page.getByLabel("Name").fill("Completion user");
  await page.getByLabel("Current city").fill("Toronto");
  await saveProfileForm(page);
  await expect(page.getByText(/age between/i)).not.toBeVisible();

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "profile.jpg",
    mimeType: "image/jpeg",
    buffer: await generateTestJpeg(page),
  });
  await expect(page.locator("img[alt='']")).toBeVisible({ timeout: 15_000 });

  async function fetchOwnProfile(): Promise<{ profileCompletedAt: string | null }> {
    const refreshResponse = await page.request.post("/api/auth/refresh");
    const { accessToken } = (await refreshResponse.json()) as { accessToken: string };
    const res = await page.request.get(`${BACKEND_URL}/v1/profile/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return (await res.json()) as { profileCompletedAt: string | null };
  }

  // displayName + birthDate + a photo, 0 prompt answers — under the
  // pre-Feature-24 rule this alone completed the profile. Real,
  // live-confirmed claim: it no longer does.
  const before = await fetchOwnProfile();
  expect(before.profileCompletedAt).toBeNull();

  // No reload needed — the manual form (already showing, per FR-227's own
  // "incomplete profile keeps the form up" behavior) can keep going.
  //
  // NOTE: the prompt label/option text below is real, live data from the
  // backend's own prompts.constants.ts — now English since Phase 5 (see
  // helpers.ts's identical note).
  await page
    .getByLabel("Add a new prompt")
    .selectOption({ label: "My best night is when…" });
  // A real, explicit checkpoint — the "Add prompt" button only enables
  // once PromptPicker's own draftPromptId state has genuinely registered
  // the selection, so this proves the select's change event actually landed
  // before the click, rather than assuming selectOption's own resolution
  // implies the app's state already caught up.
  await expect(page.getByRole("button", { name: "Add prompt" })).toBeEnabled();
  await page.getByRole("button", { name: "Add prompt" }).click();
  await expect(page.getByText("Personal prompts (1/3)")).toBeVisible();
  await page.getByLabel("My best night is when…").fill("An answer.");
  await saveProfileForm(page);

  // Still only 1 answer — still real-confirmed incomplete.
  const withOne = await fetchOwnProfile();
  expect(withOne.profileCompletedAt).toBeNull();

  await page
    .getByLabel("Add a new prompt")
    .selectOption({ label: "A weird thing about me…" });
  await expect(page.getByRole("button", { name: "Add prompt" })).toBeEnabled();
  await page.getByRole("button", { name: "Add prompt" }).click();
  await expect(page.getByText("Personal prompts (2/3)")).toBeVisible();
  await page.getByLabel("A weird thing about me…").fill("A second answer.");
  await saveProfileForm(page);

  // The 2nd real answer flips it — checked against the real backend field,
  // not a client-side assumption.
  const withTwo = await fetchOwnProfile();
  expect(withTwo.profileCompletedAt).not.toBeNull();
});
