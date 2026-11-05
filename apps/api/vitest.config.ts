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
    // ADR 0014: a notification fans out to *every* active user of a role
    // (MANAGEMENT, PMO), not just this test's own actors - so a confirm/
    // approve/decide in one test file can insert a Notification row for a
    // test user a *different*, concurrently-running file created (or is
    // mid-cleanup on). All test files share one database with no row-level
    // isolation between them, so that cross-file write is a real race, not
    // a theoretical one - it surfaced as both a flaky 500 (two queries
    // landing on the same interactive transaction's one connection) and an
    // intermittent FK violation during cleanup. Running files sequentially
    // removes the race instead of chasing each symptom individually.
    fileParallelism: false,
  },
});
