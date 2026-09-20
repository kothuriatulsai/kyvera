import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

// Authors are exposed as id + name only; a viewer's projection decides whether
// even that much is shown.
const authorSelect = { id: true, name: true } satisfies Prisma.UserSelect;

// Append-only, like the other audit-flavoured tables: no update or delete.
export function create(data: Prisma.StageProgressNoteCreateInput, db: Db = prisma) {
  return db.stageProgressNote.create({ data, include: { user: { select: authorSelect } } });
}

export function findByProductAndStages(productId: string, stageIds: string[], db: Db = prisma) {
  return db.stageProgressNote.findMany({
    where: { productId, stageId: { in: stageIds } },
    include: { user: { select: authorSelect } },
    orderBy: { createdAt: "desc" },
  });
}
