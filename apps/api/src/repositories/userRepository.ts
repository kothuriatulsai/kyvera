import type { Prisma, UserRole } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { safeUserSelect } from "./selects";

export function findById(id: string, db: Db = prisma) {
  return db.user.findUnique({ where: { id } });
}

// The full row, including passwordHash — for authentication internals only.
export function findByEmail(email: string, db: Db = prisma) {
  return db.user.findUnique({ where: { email } });
}

// Never includes passwordHash, so it's safe to hand back from an endpoint.
export function findSafeById(id: string, db: Db = prisma) {
  return db.user.findUnique({ where: { id }, select: safeUserSelect });
}

// Exactly what `authenticate` needs to decide whether a verified token is
// still good: the role (for req.actor), isActive, passwordChangedAt (to
// reject a token issued before the most recent change), and mustChangePassword
// (to gate everything but /auth/me and change-password). Deliberately not
// `safeUserSelect` - passwordChangedAt isn't meant to appear in any response.
export function findAuthSnapshotById(id: string, db: Db = prisma) {
  return db.user.findUnique({
    where: { id },
    select: { id: true, role: true, isActive: true, passwordChangedAt: true, mustChangePassword: true },
  });
}

export function findMany(db: Db = prisma) {
  return db.user.findMany({ select: safeUserSelect, orderBy: { createdAt: "asc" } });
}

export function create(data: Prisma.UserCreateInput, db: Db = prisma) {
  return db.user.create({ data, select: safeUserSelect });
}

export function updateRole(id: string, role: UserRole, db: Db = prisma) {
  return db.user.update({ where: { id }, data: { role }, select: safeUserSelect });
}

export function setActive(id: string, isActive: boolean, db: Db = prisma) {
  return db.user.update({ where: { id }, data: { isActive }, select: safeUserSelect });
}

// The one place a password changes after creation - always stamps
// passwordChangedAt alongside the hash (ADR 0011), so nothing can update one
// without the other. `mustChangePassword` is explicit at every call site
// (true for an admin reset, false for the user's own change-password) rather
// than defaulted, so it's never left as whatever it happened to be before.
export function updatePassword(
  id: string,
  passwordHash: string,
  mustChangePassword: boolean,
  db: Db = prisma,
) {
  return db.user.update({
    where: { id },
    data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword },
    select: safeUserSelect,
  });
}

// For the last-active-admin check (ADR 0011): deactivating or demoting the
// only active ADMIN would leave nobody able to manage users at all.
export function countActiveAdmins(db: Db = prisma) {
  return db.user.count({ where: { role: "ADMIN", isActive: true } });
}
