import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

export function create(data: Prisma.UserSessionCreateInput, db: Db = prisma) {
  return db.userSession.create({ data });
}

// The full row - rotation needs tokenHash/previousTokenHash/rotatedAt to
// decide which of the three outcomes (rotate, grace-rotate, reuse) applies.
export function findById(id: string, db: Db = prisma) {
  return db.userSession.findUnique({ where: { id } });
}

// A narrower select for `authenticate`'s hot-path validity check (ADR
// 0012) - runs on every authenticated request, so it only reads what that
// check needs, not the token hashes.
export function findValidityById(id: string, db: Db = prisma) {
  return db.userSession.findUnique({
    where: { id },
    select: { userId: true, revokedAt: true, expiresAt: true },
  });
}

// Conditional update (compare-and-swap): only takes effect if `tokenHash` in
// the database still matches `expectedTokenHash` - i.e. nothing else rotated
// this session between the caller's read and this write. Returns the number
// of rows changed (0 or 1), so the caller can tell a lost race from a win
// without a second round trip. ADR 0012 follow-up: a plain `update` here let
// two concurrent refreshes with the same cookie both "succeed" by blindly
// overwriting each other's rotation, corrupting previousTokenHash for one of
// them.
export function rotateIfCurrent(
  id: string,
  expectedTokenHash: string,
  data: { tokenHash: string; previousTokenHash: string; rotatedAt: Date; lastUsedAt: Date },
  db: Db = prisma,
) {
  return db.userSession.updateMany({ where: { id, tokenHash: expectedTokenHash }, data });
}

export function revoke(id: string, db: Db = prisma) {
  return db.userSession.update({ where: { id }, data: { revokedAt: new Date() } });
}

// Logout, password change, admin reset, deactivation (ADR 0012) - every one
// of that user's sessions, not just the one making the request.
export function revokeAllForUser(userId: string, db: Db = prisma) {
  return db.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Opportunistic cleanup, run once per login (ADR 0012) rather than on a
// background interval - this project has no cron infrastructure to justify
// adding for a simple housekeeping delete.
export function deleteStale(db: Db = prisma) {
  const now = new Date();
  return db.userSession.deleteMany({
    where: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: now } }] },
  });
}
