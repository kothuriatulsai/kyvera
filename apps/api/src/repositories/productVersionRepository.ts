import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

export function create(data: Prisma.ProductVersionCreateInput, db: Db = prisma) {
  return db.productVersion.create({ data });
}

export function findByProduct(productId: string, db: Db = prisma) {
  return db.productVersion.findMany({
    where: { productId },
    orderBy: { versionNumber: "desc" },
  });
}

export function findByProductAndNumber(productId: string, versionNumber: number, db: Db = prisma) {
  return db.productVersion.findUnique({
    where: { productId_versionNumber: { productId, versionNumber } },
  });
}
