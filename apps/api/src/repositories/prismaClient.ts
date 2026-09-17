import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

// Accepted by repository functions so a service can pass a $transaction
// callback's `tx` for atomic multi-step writes, or fall back to the shared
// singleton for simple reads.
export type Db = PrismaClient | Prisma.TransactionClient;

declare global {
  // eslint-disable-next-line no-var -- `var` is required for global augmentation
  var __prisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// Reused across tsx watch reloads in dev so we don't exhaust the Postgres
// connection pool by creating a new client on every file change.
export const prisma = global.__prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
