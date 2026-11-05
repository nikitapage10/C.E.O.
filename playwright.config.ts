import { defineConfig } from "@playwright/test";

const PORT = 5179;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000, // the Lattice specs set their own, from their boot budget (tests/e2e/lattice.spec.ts, #405)
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  // On the software renderer in CI a frame can land late enough to miss a hover or a click window; one more go (and
  // the report marks the test "flaky", so it stays visible) is the honest fix. Locally nothing retries.
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      // WebGL in headless Chromium via SwiftShader.
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    },
  },
  webServer: {
    command: `npm run dev -w @ceo/world -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
