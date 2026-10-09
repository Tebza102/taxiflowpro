import { defineConfig } from "@playwright/test";

// Release-gate config: points at a live deployed Preview URL (real Supabase Auth,
// real workspace_snapshots data) rather than the local mock-mode dev server used by
// playwright.config.mjs. There is deliberately no `webServer` block here - this
// suite never builds or boots anything locally, it only drives a browser against
// whatever PREVIEW_URL already is.
const PREVIEW_URL = process.env.PREVIEW_URL;

if (!PREVIEW_URL) {
  throw new Error(
    "PREVIEW_URL is required to run the Preview UAT suite (the live deployment to test against). " +
      "Never point this at the production URL.",
  );
}

// Scoped, UAT-only bypass of Vercel's own Deployment Protection (SSO gate) in
// front of *.vercel.app Preview URLs - this is a test-infrastructure concern, not
// an application auth concern, and never touches the app's own Supabase auth or
// its source. Vercel's documented mechanism: send x-vercel-protection-bypass with
// the project's Protection Bypass for Automation secret, plus
// x-vercel-set-bypass-cookie so the bypass persists via cookie for the rest of
// that browser context's requests. Only applied when the secret is present -
// deployments without SSO protection simply don't need it.
const VERCEL_BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
export const vercelBypassHeaders = VERCEL_BYPASS_SECRET
  ? {
      "x-vercel-protection-bypass": VERCEL_BYPASS_SECRET,
      "x-vercel-set-bypass-cookie": "true",
    }
  : {};

export default defineConfig({
  testDir: "./tests/uat",
  // Playwright wipes its output dir at the start of every run. The default
  // ("./test-results") is already used by the repo's other Playwright config
  // (playwright.config.mjs) and, at least at time of writing, still holds some
  // git-tracked legacy artifacts - reusing that path would silently delete them
  // on every UAT run. Keep this suite's output fully separate.
  outputDir: "./uat-reports/test-results",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "uat-reports/playwright-results.json" }],
  ],
  use: {
    baseURL: PREVIEW_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    extraHTTPHeaders: vercelBypassHeaders,
  },
});
