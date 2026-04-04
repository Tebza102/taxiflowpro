import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      'cmd /c "set VITE_BACKEND_MODE=mock&& set VITE_SUPABASE_URL=https://your-project-url.supabase.co&& set VITE_SUPABASE_ANON_KEY=sb_publishable_your-anon-key&& npm run dev -- --host 127.0.0.1 --port 4173 --clearScreen false"',
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
