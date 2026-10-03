import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

export function findLatestByTechPack(techPackId: string, db: Db = prisma) {
  return db.techPackVersion.findFirst({
    where: { techPackId },
    orderBy: { versionNumber: "desc" },
  });
}

export function create(data: Prisma.TechPackVersionCreateInput, db: Db = prisma) {
  return db.techPackVersion.create({ data });
}

// Carries the parent TechPack along (just its scalar fields, no nested
// includes) so a caller that only has a techPackId + versionNumber - a remark
// or confirmation endpoint, say - can check `voidedAt`/`code` without a
// second query.
export function findByTechPackAndNumber(techPackId: string, versionNumber: number, db: Db = prisma) {
  return db.techPackVersion.findUnique({
    where: { techPackId_versionNumber: { techPackId, versionNumber } },
    include: { techPack: true },
  });
}

// "No new version on an approved TechPack" (decided rule) is TechPack-wide, not
// per-version: once any version has been approved, the Proto Request it created
// has already fired, so the Tech Pack's job here is done.
export function hasApprovedVersion(techPackId: string, db: Db = prisma) {
  return db.techPackVersion
    .findFirst({ where: { techPackId, approval: { decision: "APPROVED" } }, select: { id: true } })
    .then((row) => row !== null);
}
