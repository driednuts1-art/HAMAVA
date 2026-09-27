import { defineConfig, devices } from "@playwright/test";

// docs/requirements.md Feature 14 FR-223: real backend, real Postgres/Redis,
// the real MockOtpProvider/MockLivenessProvider — never a mocked backend.
// `start:frontend-e2e` (backend/package.json) is the only difference from a
// normal dev boot: AUTH_OTP_DEBUG_ECHO=true, so this suite can read the
// mocked OTP code without log-scraping (Open Items #3).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3001",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Feature 18 FR-377: real fake media devices + auto-granted
        // permission prompts — the same class of flag this project already
        // established a precedent for automating real audio input
        // (Feature 15's --use-file-for-fake-audio-capture). Harmless for
        // every other suite; only calls.spec.ts actually calls
        // getUserMedia().
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: "npm run start:frontend-e2e",
      cwd: "../backend",
      url: "http://localhost:3000/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npm run dev",
      url: "http://localhost:3001",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
