import "dotenv/config";
import { resolveTestDatabaseUrl, TEST_UPLOADS_DIR } from "./testEnv";

// Runs in every worker process (unlike globalSetup.ts, which runs once in
// Vitest's main process before any worker is spawned) - set explicitly here
// too, rather than relying on a worker inheriting globalSetup's process.env
// mutation, since there's no guarantee a worker thread/fork snapshots its
// parent's env *after* that mutation rather than before it. `dotenv/config`
// above won't have overwritten these even if it ran first - it only sets a
// key that isn't already present - so this always wins regardless of order.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;
