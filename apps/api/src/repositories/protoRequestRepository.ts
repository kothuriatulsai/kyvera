import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { safeUserSelect } from "./selects";

// ADR 0013: the pinned version's files and its approval decision travel on
// the ProtoRequest response itself now, not just a stub - Finance/
// Merchandiser's only lens into a Tech Pack is through this record, so it
// has to be self-contained rather than sending them to fetch the Tech Pack
// detail they're not allowed to browse.
//
// ADR 0015, Stage 4: manufacturer/PO/confirmation travel the same way - the
// PO's own uploadedAt/uploadedBy are read off `poAttachment` directly rather
// than duplicated as separate columns on ProtoRequest.
const include = {
  project: { select: { id: true, code: true, name: true } },
  techPackVersion: {
    select: {
      id: true,
      versionNumber: true,
      techPack: { select: { id: true, code: true } },
      attachments: {
        include: { uploadedBy: { select: safeUserSelect } },
        orderBy: { uploadedAt: "asc" },
      },
      approval: { include: { decidedBy: { select: safeUserSelect } } },
    },
  },
  manufacturer: true,
  manufacturerAssignedBy: { select: safeUserSelect },
  poAttachment: { include: { uploadedBy: { select: safeUserSelect } } },
  confirmedBy: { select: safeUserSelect },
  protoWork: { select: { id: true, code: true, status: true } },
} satisfies Prisma.ProtoRequestInclude;

export function findMany(where: Prisma.ProtoRequestWhereInput = {}, db: Db = prisma) {
  return db.protoRequest.findMany({ where, include, orderBy: { createdAt: "desc" } });
}

export function findById(id: string, db: Db = prisma) {
  return db.protoRequest.findUnique({ where: { id }, include });
}

export function create(data: Prisma.ProtoRequestCreateInput, db: Db = prisma) {
  return db.protoRequest.create({ data, include });
}

// `assertAttachmentVisible` (ADR 0013): Finance/Merchandiser's only route to
// a version's files is "a Proto Request pins exactly this version".
export function existsForVersion(techPackVersionId: string, db: Db = prisma) {
  return db.protoRequest
    .findFirst({ where: { techPackVersionId }, select: { id: true } })
    .then((row) => row !== null);
}

// A narrow select for layer A's visibility pre-check (ADR 0013) before a
// Stage 4 write does anything expensive - same role `techPackRepository.
// findScopeById` plays for Tech Pack writes.
export function findScopeById(id: string, db: Db = prisma) {
  return db.protoRequest.findUnique({ where: { id }, select: { projectId: true } });
}

// Locks the row for the life of the enclosing transaction so Stage 4's three
// progressive writes (assign manufacturer, upload PO, confirm) can't race
// each other or a concurrent repeat of themselves - same raw-query pattern
// as techPackRepository.lockById (no typed `SELECT ... FOR UPDATE`). Returns
// the bare scalar row: manufacturerId/confirmedAt/code/projectId are plain
// columns on ProtoRequest itself, so no include is needed for the business-
// rule checks that use this.
export async function lockById(id: string, tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM proto_requests WHERE id = ${id} FOR UPDATE`;
  return tx.protoRequest.findUnique({ where: { id } });
}

// Step 15/16: PMO assigns (or reassigns, pre-confirmation) a manufacturer and
// records the commercial-negotiation note.
export function assignManufacturer(
  id: string,
  data: { manufacturerId: string; assignedById: string; commercialNotes?: string },
  db: Db = prisma,
) {
  return db.protoRequest.update({
    where: { id },
    data: {
      manufacturer: { connect: { id: data.manufacturerId } },
      manufacturerAssignedAt: new Date(),
      manufacturerAssignedBy: { connect: { id: data.assignedById } },
      commercialNotes: data.commercialNotes,
    },
    include,
  });
}

// Step 19: PMO confirms - locks in the agreed delivery schedule. The caller
// creates the ProtoWork row in the same transaction right after this.
export function confirm(
  id: string,
  data: { confirmedById: string; agreedDeliveryDate: Date; confirmationNote?: string },
  db: Db = prisma,
) {
  return db.protoRequest.update({
    where: { id },
    data: {
      agreedDeliveryDate: data.agreedDeliveryDate,
      confirmationNote: data.confirmationNote,
      confirmedAt: new Date(),
      confirmedBy: { connect: { id: data.confirmedById } },
    },
    include,
  });
}

// ADR 0014, PMO tasks: every field `taskService.pmoTasks` needs to decide
// "assign a manufacturer" / "confirm" / "assign to the work queue" without
// loading the full detail include. PMO is see-all, so no project scoping.
const pmoTaskSelect = {
  id: true,
  code: true,
  projectId: true,
  project: { select: { code: true } },
  manufacturerId: true,
  poAttachment: { select: { id: true } },
  confirmedAt: true,
} satisfies Prisma.ProtoRequestSelect;

export function findManyForPmoTasks(db: Db = prisma) {
  return db.protoRequest.findMany({ where: {}, select: pmoTaskSelect });
}

// ADR 0014, FINANCE tasks: same question, scoped to the Projects this actor
// is a member of (FINANCE isn't see-all).
export function findManyForFinanceTasks(projectIds: string[] | null, db: Db = prisma) {
  return db.protoRequest.findMany({
    where: {
      manufacturerId: { not: null },
      poAttachment: null,
      ...(projectIds !== null ? { projectId: { in: projectIds } } : {}),
    },
    select: pmoTaskSelect,
  });
}
