import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { safeUserSelect } from "./selects";

// ADR 0013: the pinned version's files and its approval decision travel on
// the ProtoRequest response itself now, not just a stub - Finance/
// Merchandiser's only lens into a Tech Pack is through this record, so it
// has to be self-contained rather than sending them to fetch the Tech Pack
// detail they're not allowed to browse.
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
