import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Runs once, in the main process, before any test file: provisions the
    // test database and uploads directory (see tests/globalSetup.ts).
    globalSetup: ["./tests/globalSetup.ts"],
    // Runs in every worker process, before that worker's test files: points
    // this worker at the same test database/uploads directory (see
    // tests/setup.ts and tests/testEnv.ts for why both files do this).
    setupFiles: ["./tests/setup.ts"],
  },
});
