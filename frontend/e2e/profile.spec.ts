import { test, expect } from "@playwright/test";
import {
  uniquePhone,
  loginAndReachChoiceScreen,
  loginAndCompleteProfile,
  generateTestJpeg,
  saveProfileForm,
} from "./helpers";

// FR-255: real backend throughout (real ClamAV/moderation on photo upload,
// real OpenAI extraction for the conversational path) — no mocked backend.
// The voice-turn path (Whisper transcription + extraction from a real audio
// fixture) is verified directly against the real
// /v1/profile/conversational-setup/:id/voice endpoint (documented in
// docs/requirements.md Feature 15, confirmed working end-to-end: a real
// transcript, a real proposed field) rather than through this UI — Chromium
// can feed a real audio file to a fake microphone
// (--use-file-for-fake-audio-capture), but it requires a specific raw WAV
// format the existing fixture isn't in, and the direct-API check already
// exercises the exact same backend code path this UI calls. The text-turn
// path below is a full, real UI test.

test("manual path: a real age error, a real fix, and a real photo upload complete the profile (FR-228..FR-242)", async ({
  page,
}) => {
  const phone = uniquePhone();
  await loginAndReachChoiceScreen(page, phone);

  await page.getByRole("button", { name: "Manual form" }).click();

  // FR-231: BirthDateField's own year dropdown is already bounded to the
  // real 18-100 range (docs/design-system.md's proposed-bound behavior), so
  // an "obviously too young" year isn't even a selectable option — a real
  // finding caught by running this test, not assumed. The genuine boundary
  // case instead: the *youngest* selectable year (today's Jalali year - 18)
  // combined with a month/day later in the year than today — the backend's
  // exact-age calculation (`hadBirthdayThisYear`) then computes a real age
  // of 17, not 18, still correctly rejected.
  const yearOptions = await page
    .getByLabel("Year of birth (Persian calendar)")
    .locator("option")
    .allTextContents();
  const youngestYear = Math.max(...yearOptions.map(Number));
  await page
    .getByLabel("Year of birth (Persian calendar)")
    .selectOption(String(youngestYear));
  // Month <option> values are the numeric month (1-12); "اسفند" (Esfand, the
  // last Persian-calendar month) is only the visible label text — the
  // calendar itself stays Jalali per standing project directive, so this
  // option's own label is deliberately still Persian — so it needs
  // Playwright's {label} matcher, not a plain value match.
  await page
    .getByLabel("Month of birth (Persian calendar)")
    .selectOption({ label: "اسفند" });
  await page.getByLabel("Day of birth (Persian calendar)").selectOption("29");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/age between 18 and 100/i)).toBeVisible({
    timeout: 10_000,
  });

  // Fix it for real — a birth year that's definitely a valid adult age.
  await page
    .getByLabel("Year of birth (Persian calendar)")
    .selectOption(String(youngestYear - 15));
  await page.getByLabel("Name").fill("Sarah");
  await page.getByLabel("Current city").fill("Toronto");
  // Feature 24 (FR-435): profile completeness now also requires 2 real
  // prompt answers, alongside displayName/birthDate/photo — a real
  // regression found re-running this pre-existing test after that feature
  // shipped (it used to complete with just the fields above).
  //
  // NOTE: the prompt label/option text below is real, live data from the
  // backend's own prompts.constants.ts — now English since Phase 5
  // (see helpers.ts's identical note).
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
  await saveProfileForm(page);
  await expect(page.getByText(/age between/i)).not.toBeVisible();

  // FR-238/239: a real photo upload, then the grid re-fetches for the real
  // signed URL. No photo fixture exists in the repo yet — generated
  // in-memory instead. Targeting the hidden <input type="file"> directly
  // with setInputFiles bypasses the native OS file dialog entirely (the
  // standard Playwright idiom) — no need to click the visible button first.
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "profile.jpg",
    mimeType: "image/jpeg",
    buffer: await generateTestJpeg(page),
  });
  await expect(page.locator("img[alt='']")).toBeVisible({ timeout: 15_000 });

  // Real bug report: a photo upload never touches ProfileForm's `patch`
  // state, so "Save" correctly stays disabled here (no text field was
  // edited after the last save) — but PhotoGrid must still say the upload
  // itself succeeded, independent of that unrelated button, or a user has
  // zero feedback that anything happened.
  await expect(page.getByText("Photo added.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  // FR-227: profileCompletedAt is now set (displayName+birthDate+photo) —
  // reloading "/" should show the profile view directly, not the choice
  // screen, and without a fresh login — proving the store-based gate
  // (Feature 15 Open Items #1) reflects completion for real.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "My Profile" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("conversational path: a full text session with an edited (not AI-original) proposal completes and persists the edit (FR-243..FR-250)", async ({
  page,
}) => {
  const phone = uniquePhone();
  await loginAndReachChoiceScreen(page, phone);

  await page.getByRole("button", { name: "Chat with AI" }).click();

  // First turn: a real message, real OpenAI extraction.
  await page.getByLabel("Message").fill("My name is Alex");
  await page.getByLabel("Send").click();

  // FR-246: the proposal card renders an editable text input pre-filled
  // with the AI's proposal.
  const proposalInput = page.getByLabel("Name", { exact: true });
  await expect(proposalInput).toBeVisible({ timeout: 20_000 });
  const aiProposedValue = await proposalInput.inputValue();
  expect(aiProposedValue.length).toBeGreaterThan(0);

  // FR-247's central claim: edit it before confirming.
  await proposalInput.fill("Alexander");
  await page.getByRole("button", { name: /Confirm/ }).click();

  // Confirm succeeded — the card is gone, chat continues.
  await expect(proposalInput).not.toBeVisible({ timeout: 10_000 });

  // End the session here (FR-250) rather than completing all 5 fields —
  // this test's claim is about one confirm, not the full flow.
  await page.getByRole("button", { name: "Continue with the manual form" }).click();

  // Real proof: the edited value, not the AI's original, is what the
  // backend actually has — checked via the manual form now showing it,
  // sourced from a real GET /v1/profile/me, not client-side memory.
  await expect(page.getByLabel("Name")).toHaveValue("Alexander", {
    timeout: 10_000,
  });
});

// Feature 22 FR-323/324: the identical three-state mic UX as AI Search
// (docs/requirements.md Feature 22 §6.7), driven through the real mic
// button via playwright.config.ts's global fake-media-device flags — no
// speech content needed, only real start/stop/processing transitions.
test("the conversational-setup mic button's real recording/processing states appear and clear in order (FR-323/324)", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await loginAndReachChoiceScreen(page, uniquePhone());
  await page.getByRole("button", { name: "Chat with AI" }).click();

  const startButton = page.getByRole("button", { name: "Start voice recording" });
  await expect(startButton).toBeVisible({ timeout: 15_000 });
  await startButton.click();

  await expect(page.getByText("Tell us about yourself")).toBeVisible({ timeout: 5_000 });
  const stopButton = page.getByRole("button", { name: "Stop recording" });
  await expect(stopButton).toBeVisible();

  await page.waitForTimeout(400);
  await stopButton.click();

  await expect(page.getByText("Processing…")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Processing" })).toBeDisabled();
  await expect(page.getByText("Tell us about yourself")).not.toBeVisible();

  await expect(page.getByText("Processing…")).not.toBeVisible({
    timeout: 20_000,
  });
});

test("manual path: a real bio-moderation rejection surfaces at the bio field itself (FR-231)", async ({
  page,
}) => {
  const phone = uniquePhone();
  await loginAndReachChoiceScreen(page, phone);
  await page.getByRole("button", { name: "Manual form" }).click();

  // A genuine test string, matching the real-vendor-rejection pattern
  // already used in this project's own backend e2e tests — a real OpenAI
  // Moderation API call, not a stubbed one.
  await page
    .getByLabel("About me")
    .fill(
      "I want to hurt and kill people, this is extremely violent hateful content full of graphic gore and harassment threats",
    );
  await page.getByRole("button", { name: "Save" }).click();

  // The error must render inside the bio field's own error slot
  // (components/profile/profile-form.tsx's `fieldError === "bio"` branch),
  // not the page-level ErrorState — proving ProblemDetailsFilter's `field`
  // passthrough (docs/architecture.md §5.13) actually reaches the UI.
  const bioField = page.getByLabel("About me").locator("..");
  await expect(bioField.getByRole("alert")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[role="alert"]').first()).toHaveText(
    /harassment|violence/i,
  );
});

test("BirthDateField's Jalali display matches a real, independently-known Gregorian conversion (FR-236)", async ({
  page,
}) => {
  const phone = uniquePhone();
  await loginAndReachChoiceScreen(page, phone);
  await page.getByRole("button", { name: "Manual form" }).click();

  // jalaali-js's own real conversion (verified separately against the
  // library directly, not just trusted): Jalali 1379/02/26 ↔ Gregorian
  // 2000-05-15 — chosen specifically because it falls inside
  // BirthDateField's own bounded 18-100 age range (the library's README
  // example, 1395/01/23, does not).
  await page.getByLabel("Year of birth (Persian calendar)").selectOption("1379");
  await page
    .getByLabel("Month of birth (Persian calendar)")
    .selectOption({ label: "اردیبهشت" });
  await page.getByLabel("Day of birth (Persian calendar)").selectOption("26");

  await expect(page.getByText("2000-05-15")).toBeVisible();
});

test("uploading a 7th photo is blocked by the real PROFILE_MAX_PHOTOS limit (FR-240)", async ({
  page,
}) => {
  const phone = uniquePhone();
  await loginAndReachChoiceScreen(page, phone);
  await page.getByRole("button", { name: "Manual form" }).click();

  const fileInput = page.locator('input[type="file"]');
  const jpeg = await generateTestJpeg(page);

  // PROFILE_MAX_PHOTOS=6 (backend/.env) — 6 real uploads through the real
  // ClamAV/moderation/WebP pipeline, then confirm the "Add photo" control is
  // gone (not just that a 7th click would 409 — the UI must stop offering
  // it at all, FR-240).
  for (let i = 0; i < 6; i++) {
    await fileInput.setInputFiles({
      name: `profile-${i}.jpg`,
      mimeType: "image/jpeg",
      buffer: jpeg,
    });
    await expect(page.locator("img[alt='']")).toHaveCount(i + 1, {
      timeout: 15_000,
    });
  }

  await expect(page.getByLabel("Add photo")).not.toBeVisible();
});

test("a full conversational session reaches all 5 fields and real completion (FR-243..FR-248)", async ({
  page,
}) => {
  test.setTimeout(90_000); // five real sequential OpenAI extraction calls

  const phone = uniquePhone();
  await loginAndReachChoiceScreen(page, phone);
  await page.getByRole("button", { name: "Chat with AI" }).click();

  const messagesByField: Record<string, string> = {
    displayName: "My name is Maria",
    birthDate: "I was born on May 15, 2000",
    city: "I live in Seattle",
    bio: "I'm a calm person and I love books and nature",
    interests: "I love reading, hiking, and cooking",
  };
  const fieldLabels: Record<string, string> = {
    displayName: "Name",
    birthDate: "Date of birth",
    city: "City",
    bio: "About me",
    interests: "Interests",
  };

  const remaining = new Set(Object.keys(messagesByField));

  while (remaining.size > 0) {
    // The assistant may ask about fields in whatever order it chooses —
    // answer whichever real field is still outstanding, not a fixed order.
    const nextField = remaining.values().next().value as string;
    await page.getByLabel("Message").fill(messagesByField[nextField]);
    await page.getByLabel("Send").click();

    // Whichever field the AI actually extracted this turn — not
    // necessarily `nextField`, since one clear sentence can sometimes
    // answer a different pending field than intended.
    const proposalHeading = page.getByText(/Suggestion for/);
    await expect(proposalHeading).toBeVisible({ timeout: 20_000 });
    const headingText = (await proposalHeading.textContent()) ?? "";
    const extractedField = Object.entries(fieldLabels).find(([, label]) =>
      headingText.includes(label),
    )?.[0];
    expect(extractedField, `AI did not extract a known field from: ${headingText}`).toBeTruthy();

    await page.getByRole("button", { name: /Confirm/ }).click();
    await expect(proposalHeading).not.toBeVisible({ timeout: 10_000 });
    if (extractedField) remaining.delete(extractedField);
  }

  // FR-248: driven by the server's own remainingFields — a real "nothing
  // left to ask" state replaces the chat input once all 5 conversational
  // fields are confirmed (a real gap found and fixed while writing this
  // test: docs/architecture.md §5.13). This session alone can't complete
  // the *profile* (conversational setup never touches photos), only the
  // conversational 5 fields — the UI correctly points at the photo step next.
  await expect(
    page.getByText("Got it all! Just a photo left."),
  ).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByLabel("Message")).not.toBeVisible();
});

test("a real vendor failure surfaces the manual-form escape hatch and preserves an already-confirmed field (FR-245, FR-249)", async ({
  page,
}) => {
  const phone = uniquePhone();
  await loginAndReachChoiceScreen(page, phone);
  await page.getByRole("button", { name: "Chat with AI" }).click();

  // First turn succeeds for real and is confirmed for real — this is the
  // "already-confirmed field" the escape hatch must be proven to preserve.
  await page.getByLabel("Message").fill("My name is Nina");
  await page.getByLabel("Send").click();
  const proposalInput = page.getByLabel("Name", { exact: true });
  await expect(proposalInput).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Confirm/ }).click();
  await expect(proposalInput).not.toBeVisible({ timeout: 10_000 });

  // A real, honestly-labeled network-level simulation of the exact backend
  // failure shape (docs/requirements.md FR-176/FR-245's real contract) —
  // not a mocked app, a controlled response to prove this UI's own 503
  // handling without needing to actually break the shared OpenAI key.
  await page.route("**/v1/profile/conversational-setup/*/message", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        detail: "The extraction service is unavailable. Try PATCH /v1/profile instead.",
        instance: "/v1/profile/conversational-setup/test/message",
      }),
    }),
  );

  await page.getByLabel("Message").fill("Let me say something else");
  await page.getByLabel("Send").click();

  await expect(
    page.getByText("Continue with the manual form"),
  ).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByText(/Try PATCH \/v1\/profile instead/),
  ).toBeVisible();

  // The escape hatch here is the whole error-state screen — reload lands
  // back on "/", where the gate re-reads the real, already-confirmed
  // profile state (still incomplete — no birthDate/photo — so the choice
  // screen shows again); switching to manual form there must show the
  // real, already-persisted name from before the simulated failure.
  await page.reload();
  await page.getByRole("button", { name: "Manual form" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Nina", { timeout: 10_000 });
});

// Feature 25 (FR-470..473) — found during manual walkthrough testing: a
// complete profile's own "/profile" tab went straight to the edit form,
// with no view of what other users actually see, unlike every other
// candidate in the deck.
test("a complete profile's own /profile tab opens on a real view (CandidateCard), edits behind an explicit button, and returns to view after a real save (FR-470..473)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const phone = uniquePhone();
  // loginAndCompleteProfile's own final step already reloads and lands on
  // "/profile" with a genuinely complete profile — the real starting point
  // FR-470 is about, no extra navigation needed.
  await loginAndCompleteProfile(page, phone, "Profile view user");

  // FR-470: real CandidateCard content — the prompt answer
  // loginAndCompleteProfile itself sets — not the edit form's own fields.
  //
  // NOTE: the prompt question text is real, live data from the backend's
  // own prompts.constants.ts — now English since Phase 5 (see helpers.ts's
  // identical note).
  await expect(page.getByText("My best night is when…")).toBeVisible();
  await expect(page.getByText("A simple answer.")).toBeVisible();
  const editButton = page.getByRole("button", { name: "Edit Profile" });
  await expect(editButton).toBeVisible();
  // Real proof this is view mode, not the edit form rendering the same
  // text as a label: the form's own "Save" control isn't on the page.
  await expect(page.getByRole("button", { name: "Save" })).not.toBeVisible();

  // FR-471: a real, explicit action into the real, unchanged edit form.
  await editButton.click();
  await expect(page.getByLabel("Current city")).toBeVisible();
  await expect(editButton).not.toBeVisible();

  // FR-472: a real successful save returns to view mode with the just-saved
  // data, not the form itself.
  await page.getByLabel("Current city").fill("Vancouver");
  await saveProfileForm(page);
  await expect(page.getByText("Lives in Vancouver")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel("Current city")).not.toBeVisible();
  await expect(editButton).toBeVisible();

  // FR-473: purely local UI state — a fresh reload of a complete profile
  // still opens on view mode, showing the real, persisted change.
  await page.reload();
  await expect(page.getByText("Lives in Vancouver")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Edit Profile" })).toBeVisible();
});
