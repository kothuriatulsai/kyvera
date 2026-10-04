import { mkdirSync } from "node:fs";
import "dotenv/config";
import { resolveTestDatabaseUrl, resolveTestUploadsDir } from "./testEnv";

// Runs in every worker process (unlike globalSetup.ts, which runs once in
// Vitest's main process before any worker is spawned) - set explicitly here
// too, rather than relying on a worker inheriting globalSetup's process.env
// mutation, since there's no guarantee a worker thread/fork snapshots its
// parent's env *after* that mutation rather than before it. `dotenv/config`
// above won't have overwritten these even if it ran first - it only sets a
// key that isn't already present - so this always wins regardless of order.
process.env.DATABASE_URL = resolveTestDatabaseUrl();

// This worker's own uploads directory (see testEnv.ts for why it's one per
// worker, not the shared root). Created eagerly, not left to LocalDiskStorage's
// own lazy mkdir-on-first-save, so a test that reads this directory before
// anything in this worker has uploaded yet (a "no new files" snapshot, say)
// never races an ENOENT against its own first write.
const uploadsDir = resolveTestUploadsDir();
mkdirSync(uploadsDir, { recursive: true });
process.env.UPLOADS_DIR = uploadsDir;
