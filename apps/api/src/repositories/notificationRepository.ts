import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

export function createMany(rows: Prisma.NotificationCreateManyInput[], db: Db = prisma) {
  return db.notification.createMany({ data: rows });
}

// Keyset pagination on (createdAt desc, id desc) - stable even if two rows
// share a createdAt (every event in one transaction gets the same instant).
export function findByRecipient(
  recipientId: string,
  { cursor, limit }: { cursor?: { createdAt: Date; id: string }; limit: number },
  db: Db = prisma,
) {
  return db.notification.findMany({
    where: {
      recipientId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}

export function countUnread(recipientId: string, db: Db = prisma) {
  return db.notification.count({ where: { recipientId, readAt: null } });
}

// Scoped to the recipient, not just the id - a notification that isn't the
// caller's own must 404, the same "invisible means nonexistent" shape ADR
// 0013 established, reused here for a different reason (privacy, not SOP
// visibility).
export function findByIdAndRecipient(id: string, recipientId: string, db: Db = prisma) {
  return db.notification.findFirst({ where: { id, recipientId } });
}

export function markRead(id: string, db: Db = prisma) {
  return db.notification.update({ where: { id }, data: { readAt: new Date() } });
}

export function markAllRead(recipientId: string, db: Db = prisma) {
  return db.notification.updateMany({
    where: { recipientId, readAt: null },
    data: { readAt: new Date() },
  });
}
