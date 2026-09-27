import { test, expect, type Page } from "@playwright/test";
import { uniquePhone, loginAndCompleteProfile } from "./helpers";

// Feature 16 (Discovery) — real backend throughout, matching this project's
// standing rule (FR-255, Feature 15). The AI-voice path is the one
// deliberate exception: verified directly against the real
// POST /v1/discovery/ai-search/transcribe endpoint rather than through this
// UI, for the exact reason documented on profile.spec.ts's own voice-turn
// note — Chromium's --use-file-for-fake-audio-capture needs a specific raw
// WAV format, and no Persian TTS voice is available on this machine to
// produce meaningful speech content anyway; the direct-API check exercises
// the identical backend code path (FileInterceptor('audio') →
// AiSearchExtractionService.transcribeAndExtract) this UI calls.

const BACKEND_URL = "http://localhost:3000";

/**
 * The real deck's own ordering (oldest createdAt first, deck.service.ts)
 * can't be relied on to surface a just-created counterpart within the
 * first page — many prior e2e runs have accumulated users ahead of any
 * fresh pair in that order. The GET response is replaced with a single
 * synthetic candidate carrying the *real* other user's id so the swipe
 * button's own POST (SwipeDeck's `act()`, unchanged) still submits a real
 * targetUserId to the real backend. Nothing about swipe/match logic is
 * mocked — only which candidate the deck happens to show first.
 */
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
            // a real bug found running this suite after that feature
            // shipped (an outdated mock literal missing them crashed the
            // whole page with a real, uncaught TypeError, not a mocking
            // nuance) — the real backend always includes them via
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

test("a real mutual like creates a real match and the real in-app confirmation appears (FR-259..FR-266)", async ({
  browser,
}) => {
  // Two full real logins + full real manual-profile completions (each with
  // a real photo upload through ClamAV/moderation) in one test — well past
  // Playwright's default 30s, same reasoning as profile.spec.ts's own
  // multi-turn conversational test.
  test.setTimeout(120_000);

  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  const userId1 = await loginAndCompleteProfile(page1, uniquePhone(), "User one");
  const userId2 = await loginAndCompleteProfile(page2, uniquePhone(), "User two");

  await forceDeckTarget(page1, userId2, "User two");
  await page1.goto("/");
  const like1 = page1.getByRole("button", { name: "Like", exact: true });
  await expect(like1).toBeVisible({ timeout: 10_000 });
  await like1.click();
  // Only one side has liked so far — no match yet.
  await expect(page1.getByText("It's a match!")).not.toBeVisible();

  await forceDeckTarget(page2, userId1, "User one");
  await page2.goto("/");
  const like2 = page2.getByRole("button", { name: "Like", exact: true });
  await expect(like2).toBeVisible({ timeout: 10_000 });
  await like2.click();

  // The mutual like is now real on the backend — the real match
  // confirmation (Open Item #3's deliberately simple version, not Feature
  // 17's reserved signature moment) must appear for the second swiper.
  await expect(page2.getByText("It's a match!")).toBeVisible({ timeout: 10_000 });
  await page2.getByRole("button", { name: "OK" }).click();
  await expect(page2.getByText("It's a match!")).not.toBeVisible();

  await context1.close();
  await context2.close();
});

test("applying an impossible filter for real empties the real deck (FR-267..FR-270)", async ({
  page,
}) => {
  const phone = uniquePhone();
  await loginAndCompleteProfile(page, phone, "Filter test");
  await page.goto("/");

  await page.getByRole("button", { name: "Filters" }).click();
  const minAgeInput = page.getByLabel("Minimum age");
  await expect(minAgeInput).toBeVisible({ timeout: 10_000 });

  // Every e2e-created test user (this file's and profile.spec.ts's) is
  // built with the same "youngest selectable year - 15" trick, landing at
  // the same real age well under 99 — so this real range is guaranteed to
  // exclude every real candidate in the pool, deterministically.
  await minAgeInput.fill("99");
  await page.getByLabel("Maximum age").fill("99");
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page.getByText("No one left for now")).toBeVisible({ timeout: 10_000 });
});

test("an AI-search prompt's extracted filters can be edited before confirming, and the edit (not the AI's original) is what's actually searched (FR-271..FR-278)", async ({
  page,
}) => {
  // Full real login + manual profile completion, then a real OpenAI
  // extraction round trip and a real search call — past the default 30s.
  test.setTimeout(60_000);

  const phone = uniquePhone();
  await loginAndCompleteProfile(page, phone, "Searcher");
  await page.goto("/");

  await page.getByRole("button", { name: "AI Search" }).click();
  await page
    .getByLabel("AI Search")
    .fill("someone serious, who loves books, in Toronto");
  await page.getByRole("button", { name: "Find with AI" }).click();

  const cityInput = page.getByLabel("City");
  await expect(cityInput).toBeVisible({ timeout: 20_000 });
  const aiCity = await cityInput.inputValue();

  // The central claim: edit the AI's proposal before confirming.
  await cityInput.fill("Seattle");

  const searchRequest = page.waitForRequest(
    (r) => r.url().includes("/v1/discovery/ai-search") && r.method() === "POST",
  );
  // exact: true — "Search" is otherwise a substring of the "AI Search" tab
  // button still on screen, a real ambiguity introduced by translation (the
  // two Persian labels, "جستجو" and "جست‌وجوی هوشمند", never overlapped).
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const request = await searchRequest;
  const payload = request.postDataJSON() as { city?: string };

  expect(payload.city).toBe("Seattle");
  expect(payload.city).not.toBe(aiCity);
});

test("a real vendor failure shows a generic fallback message, never the backend's raw detail text, and returns to the normal deck (FR-277)", async ({
  page,
}) => {
  const phone = uniquePhone();
  await loginAndCompleteProfile(page, phone, "Vendor test");
  await page.goto("/");
  await page.getByRole("button", { name: "AI Search" }).click();

  // A real, honestly-labeled network-level simulation of the exact backend
  // failure shape (matching profile.spec.ts's own precedent for this) — not
  // a mocked app, a controlled response to prove this UI's 503 handling
  // without needing to actually break the shared OpenAI key. The mocked
  // `detail` is deliberately raw English developer-diagnostic text, matching
  // what the real backend actually sends, to prove the UI never surfaces it.
  await page.route("**/v1/discovery/ai-search/extract", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        detail: "Search extraction service returned 503.",
        instance: "/v1/discovery/ai-search/extract",
      }),
    }),
  );

  await page.getByLabel("AI Search").fill("someone cool");
  await page.getByRole("button", { name: "Find with AI" }).click();

  // The generic fallback, independent of the backend's actual detail text.
  await expect(
    page.getByText(
      "This feature is temporarily unavailable — please try again later.",
    ),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Search extraction service returned 503.")).not.toBeVisible();
  await page.getByRole("button", { name: "Go to regular swiping" }).click();

  // Real fallback: back in deck mode, not the search screen.
  await expect(page.getByLabel("AI Search")).not.toBeVisible();
});

test("a real boost activation shows the active banner, and the real backend rejects a repeat activation with 409 (FR-279..FR-282)", async ({
  page,
}) => {
  const phone = uniquePhone();
  await loginAndCompleteProfile(page, phone, "Boost test");
  await page.goto("/");

  const activateButton = page.getByRole("button", { name: "Activate Boost" });
  await expect(activateButton).toBeVisible({ timeout: 10_000 });
  await activateButton.click();
  await expect(page.getByText("Smart Boost is active")).toBeVisible({ timeout: 10_000 });

  // Once active, the banner replaces the button — the UI itself never
  // offers a second activation click, so FR-281's 409-is-a-no-op branch is
  // proven directly against the real endpoint instead, reusing the same
  // httpOnly refresh cookie the browser already holds to mint a real
  // access token for a real second call.
  const refreshResponse = await page.request.post("/api/auth/refresh");
  const { accessToken } = (await refreshResponse.json()) as { accessToken: string };
  const repeat = await page.request.post(`${BACKEND_URL}/v1/discovery/boost`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(repeat.status()).toBe(409);
});

test("a real recorded voice prompt is transcribed and extracted through the real backend pipeline (FR-105..FR-108, documented UI exception above)", async ({
  page,
}) => {
  // Real login + profile completion, then real TTS synthesis and a real
  // Whisper transcription round trip — past the default 30s.
  test.setTimeout(60_000);

  const phone = uniquePhone();
  await loginAndCompleteProfile(page, phone, "Voice test");

  const refreshResponse = await page.request.post("/api/auth/refresh");
  const { accessToken } = (await refreshResponse.json()) as { accessToken: string };

  // A real WAV, synthesized at test time via Windows SAPI (no Persian voice
  // is installed on this machine, so the content is English — irrelevant
  // to what this test claims, which is that a real audio upload survives
  // the real Whisper transcription + extraction pipeline end to end, not
  // that the transcription is semantically perfect).
  const wavBase64 = await synthesizeSpeechBase64(
    "I am looking for someone serious who loves books and lives in Tehran.",
  );

  const response = await page.request.post(
    `${BACKEND_URL}/v1/discovery/ai-search/transcribe`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      multipart: {
        audio: {
          name: "prompt.wav",
          mimeType: "audio/wav",
          buffer: Buffer.from(wavBase64, "base64"),
        },
      },
    },
  );

  expect(response.status()).toBe(201);
  const body = (await response.json()) as {
    transcribedText: string;
    filters: Record<string, unknown>;
  };
  expect(typeof body.transcribedText).toBe("string");
  expect(body.transcribedText.length).toBeGreaterThan(0);
  // city/minAge/maxAge are legitimately null when nothing matched this
  // audio's content (ExtractedFilters' own real `| null` fields) — the
  // real contract under test is the object's shape, not non-null values.
  expect(Object.keys(body.filters).sort()).toEqual(
    ["city", "gender", "maxAge", "minAge", "relationshipGoal", "semanticQuery"].sort(),
  );
  expect(Array.isArray(body.filters.gender)).toBe(true);
  expect(Array.isArray(body.filters.relationshipGoal)).toBe(true);
  expect(typeof body.filters.semanticQuery).toBe("string");
});

// Feature 22 FR-321/322: unlike the transcription-content test above, this
// one only cares about real start/stop/processing UI transitions — no
// speech content is needed, so it drives the real mic button directly
// through playwright.config.ts's already-global fake-media-device flags
// (FR-327's correction, docs/requirements.md Feature 22 §1) rather than the
// direct-API route.
test("the mic button's real recording/processing states appear and clear in order (FR-318..322)", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await loginAndCompleteProfile(page, uniquePhone(), "Voice state test");
  await page.goto("/");
  await page.getByRole("button", { name: "AI Search" }).click();

  const startButton = page.getByRole("button", { name: "Start voice recording" });
  await expect(startButton).toBeVisible({ timeout: 10_000 });
  await startButton.click();

  // FR-319: the hint appears the instant real recording starts.
  await expect(page.getByText("Say who you're looking for")).toBeVisible({
    timeout: 5_000,
  });
  const stopButton = page.getByRole("button", { name: "Stop recording" });
  await expect(stopButton).toBeVisible();

  // A short real recording (the fake device's synthetic silence) is enough
  // to exercise the real state machine — this test asserts UI transitions,
  // not transcription content.
  await page.waitForTimeout(400);
  await stopButton.click();

  // FR-321: a real, distinct "processing" state — visible text, not just a
  // dimmed disabled button — between the real stop and the real (short)
  // transcription round trip resolving.
  await expect(page.getByText("Processing…")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Processing" })).toBeDisabled();

  // The hint is gone the instant recording stopped (FR-319: "or immediately
  // if status leaves recording first, whichever is sooner").
  await expect(page.getByText("Say who you're looking for")).not.toBeVisible();

  // Once the real transcription call resolves (success or a real vendor
  // error — either way `transcribeMutation.isPending` becomes false), the
  // processing state clears back to idle.
  await expect(page.getByText("Processing…")).not.toBeVisible({
    timeout: 20_000,
  });
});

async function synthesizeSpeechBase64(text: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const run = promisify(execFile);

  const outPath = path.join(os.tmpdir(), `hamava-voice-${Date.now()}.wav`);
  const script = [
    "Add-Type -AssemblyName System.Speech",
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    `$synth.SetOutputToWaveFile('${outPath}')`,
    `$synth.Speak('${text.replace(/'/g, "''")}')`,
    "$synth.Dispose()",
  ].join("; ");

  await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  const buffer = await fs.readFile(outPath);
  await fs.unlink(outPath).catch(() => undefined);
  return buffer.toString("base64");
}
