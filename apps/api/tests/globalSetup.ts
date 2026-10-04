import { execSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { stageDefinitionSeedData } from "../src/prisma/stageDefinitionSeedData";
import { resolveTestDatabaseUrl, TEST_UPLOADS_ROOT } from "./testEnv";

const API_ROOT = path.resolve(__dirname, ".."); // apps/api - where prisma.config.ts lives

/**
 * Runs once, before any test file, in Vitest's main process (not a worker) -
 * see vitest.config.ts's `globalSetup`. Everything here prepares the *test*
 * database and uploads directory so test runs never touch dev data (ADR: see
 * CLAUDE.md's "give tests their own database" follow-up).
 */
export default async function setup() {
  const testDatabaseUrl = resolveTestDatabaseUrl(); // throws if not a "_test" database

  await ensureDatabaseExists(testDatabaseUrl);
  runMigrations(testDatabaseUrl);
  await resetAndSeed(testDatabaseUrl);
  await resetUploadsRoot();

  // Belt-and-suspenders alongside setup.ts, which each worker runs for
  // itself - see testEnv.ts for why DATABASE_URL can't rely on this alone.
  // There's no one correct UPLOADS_DIR to set here: that's per-worker, set
  // only by setup.ts (see testEnv.ts's resolveTestUploadsDir).
  process.env.DATABASE_URL = testDatabaseUrl;

  return async function teardown() {
    await rm(TEST_UPLOADS_ROOT, { recursive: true, force: true });
    // The test database itself is left in place (truncated, not dropped) -
    // the next run's setup() truncates it again, and leaving it avoids
    // re-running `migrate deploy` from scratch every time.
  };
}

async function ensureDatabaseExists(testDatabaseUrl: string) {
  const dbName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = "/postgres"; // the standard always-present maintenance database

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (rowCount === 0) {
      // Database names can't be parameterized (they're identifiers, not
      // values) - safe here regardless, since resolveTestDatabaseUrl already
      // checked this name ends in "_test", not arbitrary input.
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await client.end();
  }
}

function runMigrations(testDatabaseUrl: string) {
  execSync("npx prisma migrate deploy", {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: "inherit",
  });
}

async function resetAndSeed(testDatabaseUrl: string) {
  const adapter = new PrismaPg({ connectionString: testDatabaseUrl });
  const prisma = new PrismaClient({ adapter });
  try {
    await truncateAllTables(prisma);

    for (const stage of stageDefinitionSeedData) {
      await prisma.stageDefinition.create({ data: stage });
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Every app table, RESTART IDENTITY CASCADE - dynamic, not a hardcoded list,
// so a table added by a later slice is covered without this file needing an
// update. RESTART IDENTITY also resets prj_code_seq/tp_code_seq/pr_code_seq
// back to 1, since the migration SQL set each one's OWNED BY the table
// column it backs (see docs/journal/2026-10-01.md) - codes start at
// PRJ-000001/TP-000001 on every run.
async function truncateAllTables(prisma: PrismaClient) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;
  if (tables.length === 0) return;

  const tableList = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}

async function resetUploadsRoot() {
  await rm(TEST_UPLOADS_ROOT, { recursive: true, force: true });
  await mkdir(TEST_UPLOADS_ROOT, { recursive: true });
}
