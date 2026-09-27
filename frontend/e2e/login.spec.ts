import { test, expect } from "@playwright/test";
import { uniquePhone, loginToLivenessStep } from "./helpers";

// FR-223, Open Items #3: this suite runs against the real backend
// (backend/package.json's `start:frontend-e2e`, AUTH_OTP_DEBUG_ECHO=true) —
// the real MockOtpProvider still never sends anything, but /otp/request's
// response echoes the real code, and PhoneStep passes it straight into
// OtpStep's auto-filled field (initialDevCode) — read it from there rather
// than fetching a code separately: a *second*, independent /otp/request call
// invalidates whichever code was issued first (otp.service.ts only tracks
// one pending code per phone), so pre-fetching and then letting the UI's own
// button click fire its own request was a real test bug caught by running
// this for real, not a defect in the app (verified: the auto-fill itself
// works — the field always shows *a* valid code, just not the pre-fetched one).

test("full phone → OTP → liveness → redirect happy path (FR-224)", async ({
  page,
}) => {
  const phone = uniquePhone();
  await loginToLivenessStep(page, phone);

  await page.getByRole("button", { name: "I agree, continue" }).click();
  await expect(page.getByText("Verifying your identity…")).toBeVisible();

  // Real mock resolves fast, but FR-218's deliberate minimum pacing still
  // has to elapse — this waits for the real redirect, not a fixed sleep.
  // A real, pre-existing staleness caught running this suite: login lands
  // on "/" first, but Feature 16 later moved the completeness gate's own
  // choice screen from "/" to "/profile" (see helpers.ts's own
  // loginAndReachChoiceScreen) — "/" itself just redirects an incomplete
  // profile straight there, so that's the real final URL, not "/".
  await expect(page).toHaveURL("http://localhost:3001/profile", {
    timeout: 10_000,
  });
  // A fresh user (no profile yet) lands on the manual-vs-conversational
  // choice screen, not the old Feature 14 placeholder this test originally
  // asserted.
  await expect(
    page.getByRole("heading", { name: "Let's build your profile" }),
  ).toBeVisible();

  // FR-207: the refresh token must never be readable by client JS.
  const cookies = await page.evaluate(() => document.cookie);
  expect(cookies).not.toContain("hamava_refresh_token");
});

test("a wrong OTP code surfaces the real backend error (FR-224)", async ({
  page,
}) => {
  const phone = uniquePhone();
  await page.goto("/login");
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Verification code")).toHaveValue(/^\d{6}$/);

  await page.getByLabel("Verification code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByText("Incorrect code")).toBeVisible();
  // Still on the OTP step, not silently advanced.
  await expect(page.getByLabel("Verification code")).toBeVisible();
});

test("a real unexpected 500 during OTP verify shows a generic message, never 'Incorrect code' and never the raw backend detail (FR-224)", async ({
  page,
}) => {
  // A real bug found live (not through this suite — a manual report): a
  // genuine, unrelated backend 500 during verify (a transient DB hiccup
  // under load, matching this project's own well-documented "combined
  // real-vendor load" pattern) was shown with the *same* hardcoded "Incorrect
  // code" title as a real wrong code, plus the backend's raw, English,
  // developer-diagnostic detail text underneath — the exact class of bug
  // FR-277/278 (Feature 26) already fixed once for AI Search's own
  // vendor-failure messages, recurring here because this screen was never
  // itself re-audited against that same standard. A real 401 (an actually
  // wrong code, the test above) must show "Incorrect code"; anything else
  // must not — this is a real, honestly-labeled network-level simulation of
  // the exact real 500 shape `ProblemDetailsFilter`'s own fallback produces
  // (`problem-details.filter.ts`'s default `detail`), not a mocked app.
  const phone = uniquePhone();
  await page.goto("/login");
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Verification code")).toHaveValue(/^\d{6}$/);

  // A real bug found writing this exact test, caught by the test itself
  // failing to reproduce the problem rather than assumed to work: the
  // browser's own real request goes to this app's *own* same-origin
  // `/api/auth/verify` Route Handler (FR-207 — it strips the refresh token
  // server-side before anything reaches the browser), never directly to the
  // backend's `/v1/auth/otp/verify` — a `page.route()` on the backend URL
  // pattern silently never matches anything the browser actually requests,
  // and the real OTP (genuinely valid) verified for real instead, moving
  // the flow on to the real liveness step. Intercepting the real,
  // browser-visible endpoint instead, with the exact same status/body/
  // content-type `relayProblemDetails` (`lib/server/backend-fetch.ts`)
  // produces when the real backend itself returns a genuine 500.
  await page.route("**/api/auth/verify", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "An unexpected error occurred.",
        instance: "/v1/auth/otp/verify",
      }),
    }),
  );

  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByText("Something went wrong")).toBeVisible();
  await expect(page.getByText("Incorrect code")).not.toBeVisible();
  // exact: true is required now that the safe fallback's own English detail
  // ("An unexpected error occurred. Please try again.",
  // lib/safe-error-message.ts's DEFAULT_FALLBACK) starts with the very same
  // words as the raw backend text this checks is never shown — a substring
  // match would now spuriously match the safe fallback too, since both are
  // English post-translation (they were trivially distinguishable by
  // language alone before).
  await expect(
    page.getByText("An unexpected error occurred.", { exact: true }),
  ).not.toBeVisible();
  await expect(page.getByLabel("Verification code")).toBeVisible();
});

test("direct navigation to a protected route while logged out redirects to /login (FR-224)", async ({
  page,
}) => {
  await page.context().clearCookies();
  // Feature 28: "/" is deliberately no longer protected (it's the real
  // public landing page for a logged-out visitor now — see
  // e2e/landing.spec.ts) — "/matches" is a genuinely still-protected route,
  // keeping this test's real point (an arbitrary protected route redirects)
  // intact without asserting something now false about "/" specifically.
  await page.goto("/matches");
  await expect(page).toHaveURL(/\/login$/);
  // Confirms the redirect happened before any protected content painted —
  // the login form is what's actually on screen, not a flash of "/matches".
  await expect(page.getByLabel("Phone number")).toBeVisible();
});

test("an invalid refresh cookie produces a real redirect back to /login (FR-224)", async ({
  page,
  context,
}) => {
  const phone = uniquePhone();
  await loginToLivenessStep(page, phone);
  await page.getByRole("button", { name: "I agree, continue" }).click();
  // Real, pre-existing staleness (same as the happy-path test above): login
  // lands on "/" first, but Feature 16 moved the completeness gate's own
  // choice screen from "/" to "/profile" — "/" just redirects there.
  await expect(page).toHaveURL("http://localhost:3001/profile", {
    timeout: 10_000,
  });

  // proxy.ts only checks presence, not validity (FR-211) — corrupting the
  // value (not removing the cookie) is what actually exercises the client-
  // side rehydration failure path, not the coarse edge gate.
  await context.addCookies([
    {
      name: "hamava_refresh_token",
      value: "corrupted-not-a-real-token",
      domain: "localhost",
      path: "/",
    },
  ]);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
});

test("the proactive refresh fires before the real access token expires (FR-224, FR-208)", async ({
  page,
}) => {
  // Installed before any navigation, per Playwright's own guidance — a fake
  // clock still ticks at real-time speed until fastForward/pauseAt is
  // called, so the login flow (including FR-218's real-paced liveness
  // animation) behaves exactly as normal up to that point.
  await page.clock.install();

  const phone = uniquePhone();
  await loginToLivenessStep(page, phone);
  await page.getByRole("button", { name: "I agree, continue" }).click();
  // Real, pre-existing staleness (same as the happy-path test above): login
  // lands on "/" first, but Feature 16 moved the completeness gate's own
  // choice screen from "/" to "/profile" — "/" just redirects there.
  await expect(page).toHaveURL("http://localhost:3001/profile", {
    timeout: 10_000,
  });

  let refreshCalls = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/auth/refresh")) refreshCalls++;
  });

  // Real 15-minute JWT_ACCESS_EXPIRES_IN, real 80%-of-lifetime scheduling
  // (FR-208) means the proactive refresh is due at ~12 minutes — jump the
  // fake clock 13 minutes forward at once rather than waiting for real time.
  await page.clock.fastForward("13:00");

  await expect.poll(() => refreshCalls, { timeout: 5_000 }).toBeGreaterThan(0);
});
