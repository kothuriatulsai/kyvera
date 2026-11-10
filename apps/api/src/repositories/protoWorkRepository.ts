import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { safeUserSelect } from "./selects";

// Stage 5's output (ADR 0015) - one row per confirmed ProtoRequest.
const include = {
  project: { select: { id: true, code: true, name: true } },
  protoRequest: { select: { id: true, code: true } },
  assignedMerchandiser: { select: safeUserSelect },
  assignedBy: { select: safeUserSelect },
  completedBy: { select: safeUserSelect },
  deliveryConfirmations: {
    include: { confirmedBy: { select: safeUserSelect } },
    orderBy: { confirmedAt: "desc" },
  },
  updates: {
    include: { author: { select: safeUserSelect } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.ProtoWorkInclude;

export function findMany(where: Prisma.ProtoWorkWhereInput = {}, db: Db = prisma) {
  return db.protoWork.findMany({ where, include, orderBy: { createdAt: "desc" } });
}

export function findById(id: string, db: Db = prisma) {
  return db.protoWork.findUnique({ where: { id }, include });
}

// A narrow select for layer A's visibility pre-check (ADR 0013) before a
// write does anything expensive - same role as techPackRepository.findScopeById.
// Also carries `assignedMerchandiserId`/`status`, needed by every write's
// "only the assigned Merchandiser" check (ADR 0015, revised) without a
// second query.
export function findScopeById(id: string, db: Db = prisma) {
  return db.protoWork.findUnique({
    where: { id },
    select: { projectId: true, assignedMerchandiserId: true, status: true },
  });
}

// Created inside protoRequestService.confirmProtoRequest's own transaction.
export function create(data: Prisma.ProtoWorkCreateInput, db: Db = prisma) {
  return db.protoWork.create({ data, include });
}

// Locks the row for the life of the enclosing transaction - assign/complete
// and a delivery-date reconfirmation must not race each other. Same
// raw-query pattern as techPackRepository.lockById; returns the bare scalar
// row (status/assignedMerchandiserId/completedAt are plain columns here).
export async function lockById(id: string, tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM proto_work WHERE id = ${id} FOR UPDATE`;
  return tx.protoWork.findUnique({ where: { id } });
}

// Step 20: PMO assigns from the Work Queue.
export function assign(
  id: string,
  data: { merchandiserId: string; assignedById: string },
  db: Db = prisma,
) {
  return db.protoWork.update({
    where: { id },
    data: {
      assignedMerchandiser: { connect: { id: data.merchandiserId } },
      assignedAt: new Date(),
      assignedBy: { connect: { id: data.assignedById } },
      status: "ASSIGNED",
    },
    include,
  });
}

// Step 22: a (re)confirmed delivery date becomes the new current state - the
// caller also appends a ProtoWorkDeliveryConfirmation history row in the
// same transaction (protoWorkDeliveryConfirmationRepository.create).
export function updateCurrentDeliveryDate(id: string, deliveryDate: Date, db: Db = prisma) {
  return db.protoWork.update({ where: { id }, data: { currentDeliveryDate: deliveryDate } });
}

// Step 23.
export function complete(id: string, completedById: string, db: Db = prisma) {
  return db.protoWork.update({
    where: { id },
    data: { completedAt: new Date(), completedBy: { connect: { id: completedById } }, status: "COMPLETED" },
    include,
  });
}

// ADR 0014, PMO's "assign to the work queue" task - PMO is see-all, so no
// project scoping.
export function findManyQueued(db: Db = prisma) {
  return db.protoWork.findMany({
    where: { status: "QUEUED" },
    select: { id: true, code: true, projectId: true, project: { select: { code: true } } },
  });
}

// ADR 0014, MERCHANDISER's "reconfirm delivery date" task - scoped to the
// Projects this actor is a member of, and only this actor's own assignment
// (workload-tracking metadata doubling as the task's own scope here, unlike
// every write action on this table, which isn't restricted to the assignee).
// Just enough to decide staleness: the latest confirmation's date, or
// `assignedAt` if there isn't one yet.
const merchandiserTaskSelect = {
  id: true,
  code: true,
  projectId: true,
  project: { select: { code: true } },
  assignedAt: true,
  deliveryConfirmations: { orderBy: { confirmedAt: "desc" }, take: 1, select: { confirmedAt: true } },
} satisfies Prisma.ProtoWorkSelect;

export function findManyAssignedTo(merchandiserId: string, projectIds: string[] | null, db: Db = prisma) {
  return db.protoWork.findMany({
    where: {
      assignedMerchandiserId: merchandiserId,
      completedAt: null,
      ...(projectIds !== null ? { projectId: { in: projectIds } } : {}),
    },
    select: merchandiserTaskSelect,
  });
}
