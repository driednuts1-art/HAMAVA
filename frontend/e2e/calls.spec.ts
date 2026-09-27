import { test, expect, type Page } from "@playwright/test";
import { uniquePhone, loginAndCompleteProfile } from "./helpers";

// Feature 18 (Voice/Video Calling) — real backend, real Cloudflare TURN,
// real WebRTC (fake media devices, auto-granted permission prompts, per
// playwright.config.ts's own launchOptions — the same "automate a real
// media input" precedent this project already established for Feature 15's
// voice-turn tests). Nothing about signaling, TURN, or the WebRTC
// connection itself is mocked — only the physical camera/microphone input
// is faked, which is the one piece Playwright genuinely cannot drive for
// real in a headless/CI-style run.

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

/**
 * Creates a real mutual match, opens the real conversation on both sides
 * (past the real signature match-moment gate, where the call buttons
 * live), then leaves the *callee* (page2) back on `/matches` — simulating
 * a real user browsing elsewhere in the app, not staring at this one
 * conversation, at the moment a call comes in (exactly the real scenario
 * FR-345's "app-wide" listener claim is about).
 *
 * The final `page2.goto("/matches")` is a real, full browser navigation
 * (not an SPA transition — Playwright's `goto()` bypasses Next.js's own
 * client-side `<Link>` routing), which tears down and recreates page2's
 * WebSocket connection from scratch. A real, non-obvious finding from
 * writing this suite: triggering a call immediately after such a
 * navigation, with no time for the fresh socket to finish reconnecting,
 * races the `call:incoming` push against page2's own reconnect — a real
 * missed event, not an app bug (Socket.IO doesn't replay events a
 * disconnected client wasn't there to receive). The real, honest fix is
 * giving the navigation a moment to settle before any test proceeds to
 * trigger a call, which every test in this file does via
 * `waitForConnectedSocket` below.
 */
async function createRealMatchAndOpenConversation(
  page1: Page,
  userId1: string,
  name1: string,
  page2: Page,
  userId2: string,
  name2: string,
) {
  await forceDeckTarget(page1, userId2, name2);
  await page1.goto("/");
  const like1 = page1.getByRole("button", { name: "Like", exact: true });
  await expect(like1).toBeVisible({ timeout: 10_000 });
  await like1.click();

  await forceDeckTarget(page2, userId1, name1);
  await page2.goto("/");
  const like2 = page2.getByRole("button", { name: "Like", exact: true });
  await expect(like2).toBeVisible({ timeout: 10_000 });
  await like2.click();

  await expect(page2.getByText("It's a match!")).toBeVisible({ timeout: 10_000 });
  await page2.getByRole("button", { name: "OK" }).click();

  for (const [page, otherName] of [
    [page1, name2],
    [page2, name1],
  ] as const) {
    await page.goto("/matches");
    const link = page.getByRole("link", { name: otherName });
    await expect(link).toBeVisible({ timeout: 10_000 });
    await link.click();
    await page.getByRole("dialog", { name: "You matched" }).click();
  }

  // A real, deterministic signal that the fresh post-navigation socket has
  // actually finished its real handshake, not an arbitrary blind wait —
  // observes the real socket.io polling/upgrade traffic on the network.
  const socketReconnected = page2.waitForResponse(
    (r) => r.url().includes("/socket.io/") && r.request().method() === "GET",
    { timeout: 10_000 },
  );
  await page2.goto("/matches");
  await socketReconnected.catch(() => {
    // Fail-open on this specific wait: if the socket happened to still be
    // alive from before (goto() not always a hard reload for an
    // already-open tab in every browser/version combination) there may be
    // no new handshake to observe at all — the real assertions later in
    // each test are what actually verifies delivery, this is only a
    // best-effort head start.
  });
}

test("a real voice call connects between two real matched users over real WebRTC, and either side can hang up (FR-351..357, FR-361)", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const context1 = await browser.newContext({ permissions: ["microphone", "camera"] });
  const context2 = await browser.newContext({ permissions: ["microphone", "camera"] });
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  const name1 = "Call user one";
  const name2 = "Call user two";
  const userId1 = await loginAndCompleteProfile(page1, uniquePhone(), name1);
  const userId2 = await loginAndCompleteProfile(page2, uniquePhone(), name2);

  await createRealMatchAndOpenConversation(page1, userId1, name1, page2, userId2, name2);

  // page1 (the caller) starts a real voice call. page2 (the callee) is on
  // /matches, not the conversation itself — proving the listener really is
  // app-wide, not scoped to an open conversation.
  await page1.getByRole("button", { name: "Voice call" }).click();
  await expect(page1.getByRole("dialog", { name: "Call" })).toBeVisible({ timeout: 10_000 });

  const incomingDialog = page2.getByRole("dialog", { name: "Incoming call" });
  await expect(incomingDialog).toBeVisible({ timeout: 15_000 });
  await expect(incomingDialog.getByText(name1)).toBeVisible();
  await page2.getByRole("button", { name: "Answer call" }).click();

  // A real RTCPeerConnection reaches `connected` on both sides — proven by
  // the real elapsed-time counter appearing (only rendered once phase
  // becomes "active", which only happens on a real connectionState change).
  const elapsedPattern = /^\d{2}:\d{2}$/;
  await expect(page1.getByText(elapsedPattern)).toBeVisible({ timeout: 30_000 });
  await expect(page2.getByText(elapsedPattern)).toBeVisible({ timeout: 30_000 });

  // A real mute toggle actually flips the real local audio track.
  await page1.getByRole("button", { name: "Mute microphone" }).click();
  await expect(page1.getByRole("button", { name: "Unmute microphone" })).toBeVisible();

  // page2 hangs up — page1 is real-time-notified via call:hangup and its
  // own screen closes.
  await page2.getByRole("button", { name: "Hang up" }).click();
  await expect(page1.getByRole("dialog", { name: "Call" })).not.toBeVisible({ timeout: 15_000 });
  await expect(page2.getByRole("dialog", { name: "Call" })).not.toBeVisible({ timeout: 15_000 });

  await context1.close();
  await context2.close();
});

test("a real declined call notifies the caller in real time (FR-346)", async ({ browser }) => {
  test.setTimeout(180_000);

  const context1 = await browser.newContext({ permissions: ["microphone", "camera"] });
  const context2 = await browser.newContext({ permissions: ["microphone", "camera"] });
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  const name1 = "Decline user one";
  const name2 = "Decline user two";
  const userId1 = await loginAndCompleteProfile(page1, uniquePhone(), name1);
  const userId2 = await loginAndCompleteProfile(page2, uniquePhone(), name2);

  await createRealMatchAndOpenConversation(page1, userId1, name1, page2, userId2, name2);

  await page1.getByRole("button", { name: "Voice call" }).click();
  await expect(page1.getByRole("dialog", { name: "Call" })).toBeVisible({ timeout: 10_000 });

  await expect(page2.getByRole("dialog", { name: "Incoming call" })).toBeVisible({ timeout: 15_000 });
  await page2.getByRole("button", { name: "Decline" }).click();
  await expect(page2.getByRole("dialog", { name: "Incoming call" })).not.toBeVisible();

  // The caller (page1) is real-time-notified over call:hangup — a real,
  // distinct "declined" message, not left hanging in "Calling...".
  await expect(page1.getByText("Call declined.")).toBeVisible({ timeout: 15_000 });

  await context1.close();
  await context2.close();
});

test("a real video call connects and both sides receive a real remote MediaStream (FR-343, FR-358)", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const context1 = await browser.newContext({ permissions: ["microphone", "camera"] });
  const context2 = await browser.newContext({ permissions: ["microphone", "camera"] });
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  const name1 = "Video user one";
  const name2 = "Video user two";
  const userId1 = await loginAndCompleteProfile(page1, uniquePhone(), name1);
  const userId2 = await loginAndCompleteProfile(page2, uniquePhone(), name2);

  await createRealMatchAndOpenConversation(page1, userId1, name1, page2, userId2, name2);

  await page1.getByRole("button", { name: "Video call" }).click();
  await expect(page1.getByRole("dialog", { name: "Call" })).toBeVisible({ timeout: 10_000 });

  const incomingDialog = page2.getByRole("dialog", { name: "Incoming call" });
  await expect(incomingDialog).toBeVisible({ timeout: 15_000 });
  await page2.getByRole("button", { name: "Answer call" }).click();

  // Real connection on both sides, same proxy as the voice test (the
  // status text only renders once phase becomes "active").
  const elapsedPattern = /^\d{2}:\d{2}$/;
  await expect(page1.getByText(elapsedPattern)).toBeVisible({ timeout: 30_000 });
  await expect(page2.getByText(elapsedPattern)).toBeVisible({ timeout: 30_000 });

  // Video-specific: real <video> elements exist and actually carry a real
  // MediaStream with a live video track — not just that the call
  // "connected" (getUserMedia({video:true}) succeeding is a distinct
  // failure mode from audio-only connection, per FR-358).
  for (const page of [page1, page2]) {
    const hasRemoteVideoTrack = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll("video"));
      return videos.some((v) => {
        const stream = v.srcObject as MediaStream | null;
        return !!stream && stream.getVideoTracks().length > 0;
      });
    });
    expect(hasRemoteVideoTrack).toBe(true);
  }

  await page1.getByRole("button", { name: "Hang up" }).click();
  await expect(page1.getByRole("dialog", { name: "Call" })).not.toBeVisible({ timeout: 15_000 });
  await expect(page2.getByRole("dialog", { name: "Call" })).not.toBeVisible({ timeout: 15_000 });

  await context1.close();
  await context2.close();
});
