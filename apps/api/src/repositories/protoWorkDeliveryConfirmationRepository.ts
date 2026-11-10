import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

// Append-only history (ADR 0015) paired with ProtoWork.currentDeliveryDate as
// current state - step 22's "periodic delivery-date confirmation". Always
// created alongside a protoWorkRepository.updateCurrentDeliveryDate call in
// the same transaction.
export function create(data: Prisma.ProtoWorkDeliveryConfirmationCreateInput, db: Db = prisma) {
  return db.protoWorkDeliveryConfirmation.create({ data });
}

export function findByProtoWork(protoWorkId: string, db: Db = prisma) {
  return db.protoWorkDeliveryConfirmation.findMany({
    where: { protoWorkId },
    orderBy: { confirmedAt: "desc" },
  });
}
