import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

const include = {
  project: { select: { id: true, code: true, name: true } },
  techPackVersion: {
    select: {
      id: true,
      versionNumber: true,
      techPack: { select: { id: true, code: true } },
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
