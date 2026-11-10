import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

// Master data (ADR 0015) - PMO/ADMIN only, no visibility-module involvement
// (it isn't Project-scoped at all).

export function findMany(where: Prisma.ManufacturerMasterWhereInput = {}, db: Db = prisma) {
  return db.manufacturerMaster.findMany({ where, orderBy: { name: "asc" } });
}

export function findById(id: string, db: Db = prisma) {
  return db.manufacturerMaster.findUnique({ where: { id } });
}

export function create(data: Prisma.ManufacturerMasterCreateInput, db: Db = prisma) {
  return db.manufacturerMaster.create({ data });
}

export function update(id: string, data: Prisma.ManufacturerMasterUpdateInput, db: Db = prisma) {
  return db.manufacturerMaster.update({ where: { id }, data });
}

export function setActive(id: string, isActive: boolean, db: Db = prisma) {
  return db.manufacturerMaster.update({ where: { id }, data: { isActive } });
}
