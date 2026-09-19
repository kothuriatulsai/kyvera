import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

export function create(data: Prisma.ProductStageHistoryCreateInput, db: Db = prisma) {
  return db.productStageHistory.create({ data });
}

export function findOpenEntry(productId: string, stageId: string, db: Db = prisma) {
  return db.productStageHistory.findFirst({
    where: { productId, stageId, exitedAt: null },
  });
}

export function findAllByProduct(productId: string, db: Db = prisma) {
  return db.productStageHistory.findMany({
    where: { productId },
    include: { stage: true },
    orderBy: { enteredAt: "asc" },
  });
}

export function findAllByProducts(productIds: string[], db: Db = prisma) {
  return db.productStageHistory.findMany({
    where: { productId: { in: productIds } },
    include: { stage: true },
    orderBy: { enteredAt: "asc" },
  });
}

export function closeEntry(
  id: string,
  data: Pick<
    Prisma.ProductStageHistoryUpdateInput,
    "exitedAt" | "actualDurationDays" | "delayed" | "delayReason" | "responsibleUser"
  >,
  db: Db = prisma,
) {
  return db.productStageHistory.update({ where: { id }, data });
}
