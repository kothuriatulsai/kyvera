import { defineConfig, devices } from '@playwright/test'

// CI starts the built web app (vite preview) and the compiled API itself,
// then points this at them - see .github/workflows/ci.yml. There is no
// `webServer` entry here: CI owns that lifecycle so it can seed the test
// database in between starting the API and running these tests.
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
