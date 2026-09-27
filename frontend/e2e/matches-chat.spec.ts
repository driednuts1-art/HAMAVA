import { test, expect, type Page } from "@playwright/test";
import { uniquePhone, loginAndCompleteProfile } from "./helpers";

// Feature 17 (Match & Chat) — real backend and real WebSocket throughout,
// per this project's standing "never mock the backend" rule. The only
// route interception used is forceDeckTarget, identical in spirit to
// discovery.spec.ts's own helper: it only changes *which* candidate the
// deck shows first (the real deck's own oldest-createdAt-first ordering
// can't be relied on to surface a fresh pair among many accumulated real
// e2e users) — the swipe/match/chat logic underneath is never mocked.

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

/** Creates a real mutual match between two already-logged-in, complete profiles. */
async function createRealMatch(
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
}

test("two real matched users chat live over the real WebSocket, the signature moment plays once, feedback and report both persist (FR-311..FR-339)", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  const name1 = "Chat user one";
  const name2 = "Chat user two";
  const userId1 = await loginAndCompleteProfile(page1, uniquePhone(), name1);
  const userId2 = await loginAndCompleteProfile(page2, uniquePhone(), name2);

  await createRealMatch(page1, userId1, name1, page2, userId2, name2);

  // FR-314/317: opening a brand-new match from the "New Matches" row plays
  // the real signature moment first.
  await page1.goto("/matches");
  const newMatchLink1 = page1.getByRole("link", { name: name2 });
  await expect(newMatchLink1).toBeVisible({ timeout: 10_000 });
  await newMatchLink1.click();
  await expect(page1.getByRole("dialog", { name: "You matched" })).toBeVisible({
    timeout: 10_000,
  });
  // getByText() is ambiguous here (a real, pre-existing bug found running
  // Feature 29's own regression, unrelated to that feature): Next.js's own
  // hidden accessibility live-region (`#__next-route-announcer__`) mirrors
  // the same just-navigated text, so it matches too — scoped to the real
  // heading instead.
  await expect(page1.getByRole("heading", { name: "In Harmony!" })).toBeVisible();
  await page1.getByRole("dialog", { name: "You matched" }).click();
  await expect(page1.getByRole("dialog", { name: "You matched" })).not.toBeVisible({
    timeout: 5_000,
  });

  // FR-327: a brand-new, zero-message conversation shows the real
  // inviting first-message prompt.
  await expect(page1.getByText(`Send the first message to ${name2}`)).toBeVisible();

  // FR-323: a real sent message appears immediately (optimistic, then
  // reconciled against the real POST response).
  await page1.getByLabel("Message").fill("Hi!");
  await page1.getByRole("button", { name: "Send" }).click();
  await expect(page1.getByText("Hi!")).toBeVisible({ timeout: 10_000 });
  await expect(page1.getByText("Failed to send")).not.toBeVisible();

  // FR-324: the real WebSocket delivers this to user 2's own open
  // conversation, live, with no page reload — user 2 opens the match from
  // their own "New Matches" row first (their own moment gate).
  await page2.goto("/matches");
  const newMatchLink2 = page2.getByRole("link", { name: name1 });
  await expect(newMatchLink2).toBeVisible({ timeout: 10_000 });
  await newMatchLink2.click();
  await expect(page2.getByRole("dialog", { name: "You matched" })).toBeVisible({
    timeout: 10_000,
  });
  await page2.getByRole("dialog", { name: "You matched" }).click();
  await expect(page2.getByText("Hi!")).toBeVisible({ timeout: 15_000 });

  // A real reply from user 2, delivered live back to user 1's still-open
  // conversation.
  await page2.getByLabel("Message").fill("Hi, how are you?");
  await page2.getByRole("button", { name: "Send" }).click();
  await expect(page1.getByText("Hi, how are you?")).toBeVisible({ timeout: 15_000 });

  // FR-338/339: optional match feedback — persists, and shows the
  // already-rated state on reload without re-prompting.
  await page1.getByRole("button", { name: "Really good" }).click();
  await expect(page1.getByText(/Feedback recorded/)).toBeVisible({ timeout: 10_000 });
  await page1.reload();
  await expect(page1.getByText(/Feedback recorded/)).toBeVisible({ timeout: 10_000 });
  await expect(page1.getByRole("button", { name: "Really good" })).not.toBeVisible();

  // FR-336: a real report submission (a non-"Other" category needs no
  // reason text).
  await page1.getByRole("button", { name: "Safety" }).click();
  await page1.getByRole("button", { name: "Report this user" }).click();
  await page1.getByRole("radio", { name: "Spam" }).check();
  const reportResponsePromise = page1.waitForResponse(
    (r) => r.url().includes("/report") && r.request().method() === "POST",
  );
  await page1.getByRole("button", { name: "Submit report" }).click();
  const reportResponse = await reportResponsePromise;
  expect(reportResponse.ok()).toBe(true);

  // FR-320: reopening the same match a second time does not replay the
  // signature moment. A plain SPA navigation (not a full page reload) is
  // enough to re-fetch the real list — a reload here would additionally
  // race a background token refresh against the fresh page's own
  // rehydration (the already-known, already-documented "fast
  // double-navigation" refresh-token-rotation race — Feature 14 FR-208's
  // own comment), which is real but orthogonal to what this assertion
  // actually verifies.
  await page1.goto("/matches");
  const conversationLink1 = page1.getByRole("link", { name: name2 });
  await expect(conversationLink1).toBeVisible({ timeout: 10_000 });
  await conversationLink1.click();
  await expect(page1.getByRole("dialog", { name: "You matched" })).not.toBeVisible({
    timeout: 3_000,
  });
  await expect(page1.getByText("Hi, how are you?")).toBeVisible({ timeout: 10_000 });

  await context1.close();
  await context2.close();
});

test("a real block removes the conversation from the real match list (FR-334/335)", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  const name1 = "Block user one";
  const name2 = "Block user two";
  const userId1 = await loginAndCompleteProfile(page1, uniquePhone(), name1);
  const userId2 = await loginAndCompleteProfile(page2, uniquePhone(), name2);

  await createRealMatch(page1, userId1, name1, page2, userId2, name2);

  await page1.goto("/matches");
  const matchLink = page1.getByRole("link", { name: name2 });
  await expect(matchLink).toBeVisible({ timeout: 10_000 });
  await matchLink.click();
  await page1.getByRole("dialog", { name: "You matched" }).click();

  await page1.getByRole("button", { name: "Safety" }).click();
  await page1.getByRole("button", { name: "Block" }).click();
  const blockResponsePromise = page1.waitForResponse(
    (r) => r.url().includes("/block") && r.request().method() === "POST",
  );
  await page1.getByRole("button", { name: "Yes, block" }).click();
  const blockResponse = await blockResponsePromise;
  expect(blockResponse.ok()).toBe(true);

  await expect(page1).toHaveURL("http://localhost:3001/matches", { timeout: 10_000 });
  await expect(page1.getByRole("link", { name: name2 })).not.toBeVisible({
    timeout: 10_000,
  });

  await context1.close();
  await context2.close();
});
