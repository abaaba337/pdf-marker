import { defineConfig } from "@playwright/test";

// Runs headless against the built page on a throwaway workspace, never a real one.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 30_000,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:8799",
    viewport: { width: 1360, height: 1200 },
    channel: process.env.CI ? undefined : "chrome",
  },
  webServer: {
    command: "python ../scripts/e2e_server.py",
    url: "http://127.0.0.1:8799/api/tree",
    reuseExistingServer: false,
  },
});
