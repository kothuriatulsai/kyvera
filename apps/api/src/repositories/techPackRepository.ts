import type { Prisma, ProjectPhase } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { safeUserSelect } from "./selects";

const versionInclude = {
  uploadedBy: { select: safeUserSelect },
  attachments: {
    include: { uploadedBy: { select: safeUserSelect } },
    orderBy: { uploadedAt: "asc" },
  },
  remarks: {
    include: { author: { select: safeUserSelect } },
    orderBy: { createdAt: "asc" },
  },
  confirmation: { include: { confirmedBy: { select: safeUserSelect } } },
  approval: { include: { decidedBy: { select: safeUserSelect } } },
} satisfies Prisma.TechPackVersionInclude;

const detailInclude = {
  project: { select: { id: true, code: true, name: true, phase: true } },
  createdBy: { select: safeUserSelect },
  voidedBy: { select: safeUserSelect },
  supersedes: { select: { id: true, code: true } },
  supersededBy: { select: { id: true, code: true } },
  versions: { include: versionInclude, orderBy: { versionNumber: "desc" } },
} satisfies Prisma.TechPackInclude;

const listInclude = {
  project: { select: { id: true, code: true, name: true } },
  createdBy: { select: safeUserSelect },
} satisfies Prisma.TechPackInclude;

export function findMany(where: Prisma.TechPackWhereInput, db: Db = prisma) {
  return db.techPack.findMany({ where, include: listInclude, orderBy: { createdAt: "desc" } });
}

export function findById(id: string, db: Db = prisma) {
  return db.techPack.findUnique({ where: { id }, include: detailInclude });
}

// At most one non-voided TechPack per Project per phase (decided rule, enforced
// here rather than a DB constraint - see techPackService.createTechPack).
export function findActiveByProjectAndPhase(projectId: string, phase: ProjectPhase, db: Db = prisma) {
  return db.techPack.findFirst({ where: { projectId, phase, voidedAt: null } });
}

export function create(data: Prisma.TechPackCreateInput, db: Db = prisma) {
  return db.techPack.create({ data });
}

// Management's rejection path (SOP Stage 3). Void traceability lives on the
// row itself (ADR 0006 point 3) even though the full decision record - who,
// when, the rest of the notes - is also on the TechPackApproval row that
// triggers this; the two aren't redundant, this copy is for "why was this
// voided" as a direct column read.
export function voidTechPack(
  id: string,
  data: { voidedById: string; voidReason: string },
  db: Db = prisma,
) {
  return db.techPack.update({
    where: { id },
    data: {
      voidedAt: new Date(),
      voidedBy: { connect: { id: data.voidedById } },
      voidReason: data.voidReason,
    },
  });
}

// Locks the row for the life of the enclosing transaction so a concurrent
// version upload (or, once it exists, an approval) can't race past this read -
// e.g. approve a version that stopped being the latest a moment earlier.
// `SELECT ... FOR UPDATE` has no typed Prisma equivalent, hence the raw query.
export async function lockById(id: string, tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM tech_packs WHERE id = ${id} FOR UPDATE`;
  return tx.techPack.findUnique({ where: { id } });
}
