import os from "node:os";
import path from "node:path";
import "dotenv/config";

// Shared between globalSetup.ts (provisions the test database/uploads dir
// once) and setup.ts (points each test worker at them) - both must resolve
// to the exact same values, so this is the one place that decides them.

const DEFAULT_TEST_DATABASE_URL = "postgresql://kyvera:kyvera@localhost:5432/kyvera_test?schema=public";

/**
 * SAFETY GUARD: throws unless the target database's name ends in "_test".
 * globalSetup truncates every table in this database before each run - a
 * typo or a misconfigured env that pointed this at the dev database would be
 * a one-line way to wipe it, so this check runs before any connection is
 * even opened, not just before the truncate itself.
 */
export function resolveTestDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL?.trim();
  const url = raw ? raw : DEFAULT_TEST_DATABASE_URL;

  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `TEST_DATABASE_URL must point at a database whose name ends in "_test" (got "${dbName}") - ` +
        "refusing to run tests against it. This guards against a test run ever truncating a " +
        "non-test database.",
    );
  }
  return url;
}

// A fixed root, not a fresh mkdtemp() per run: every worker process needs to
// resolve to a directory under it independently (there is no reliable way to
// hand a randomly-generated path from globalSetup, which runs once in the
// main process, to every worker it spawns), and globalSetup removes and
// recreates the whole root on each run anyway, so a stable name costs nothing.
export const TEST_UPLOADS_ROOT = path.join(os.tmpdir(), "kyvera-test-uploads");

/**
 * Each vitest worker gets its own subdirectory under the root, keyed by
 * `VITEST_POOL_ID` (set by Vitest, unique per worker process). Without this,
 * two test files running in different workers at the same time shared one
 * uploads directory - harmless for most tests, but a test that snapshots
 * "no new files appeared" could be tripped by a completely unrelated upload
 * from another file's worker landing in the same window (the actual cause of
 * an intermittent failure in techPacks.test.ts's orphan-file test).
 */
export function resolveTestUploadsDir(): string {
  const poolId = process.env.VITEST_POOL_ID ?? "main";
  return path.join(TEST_UPLOADS_ROOT, poolId);
}
