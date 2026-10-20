import { readFileSync } from "node:fs";

import { defineConfig } from "@playwright/test";

// Authenticated journey against a hosted Vercel PREVIEW whose backend is the
// ISOLATED test project (taxiflow-preview-test). Never production:
//  * PREVIEW_URL must be a *.vercel.app deployment URL (never taxiflow.co.za);
//  * the first test proves the deployed bundle points at PREVIEW_TEST_REF and
//    not at the production project before anything signs in.
// Secrets come only from the git-ignored .env.preview-test.local (synthetic
// account password and the temporary Vercel automation-bypass secret); nothing
// is printed.
//   PREVIEW_URL=https://taxiflowpro-xxxx-apprigate.vercel.app npx playwright test -c playwright.preview-test.config.mjs
const env = Object.fromEntries(
  (() => {
    try {
      return readFileSync(".env.preview-test.local", "utf8").split(/\r?\n/);
    } catch {
      return [];
    }
  })()
    .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);
for (const key of ["PREVIEW_TEST_REF", "PREVIEW_TEST_PASSWORD", "PREVIEW_BYPASS_SECRET"]) {
  if (!process.env[key] && env[key]) process.env[key] = env[key];
  if (!process.env[key]) throw new Error(`${key} is missing (.env.preview-test.local).`);
}
const PREVIEW_URL = String(process.env.PREVIEW_URL ?? "");
if (!/^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/.test(PREVIEW_URL) || /taxiflow\.co\.za/.test(PREVIEW_URL)) {
  throw new Error("PREVIEW_URL must be a *.vercel.app Preview deployment URL.");
}
if (process.env.PREVIEW_TEST_REF === "vfxftviwteypasredjgm") throw new Error("Refusing: that is the production project.");

export default defineConfig({
  testDir: "./tests/preview-test",
  outputDir: "./uat-reports/preview-test-results",
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: PREVIEW_URL.replace(/\/$/, ""),
    headless: true,
    screenshot: "only-on-failure",
    // No traces: they would record the typed test password.
    trace: "off",
    extraHTTPHeaders: {
      "x-vercel-protection-bypass": process.env.PREVIEW_BYPASS_SECRET,
      "x-vercel-set-bypass-cookie": "true",
    },
  },
});
