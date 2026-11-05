import type { Prisma } from "@prisma/client";
import * as notificationRepository from "../repositories/notificationRepository";
import * as projectMemberRepository from "../repositories/projectMemberRepository";
import * as userRepository from "../repositories/userRepository";
import type { Actor } from "./tokenService";
import { NotFoundError } from "./errors";

/**
 * ADR 0014: a stored, append-only event log, written in the same
 * transaction as the action that caused it (every `notify*` below takes
 * `tx`, never the bare `prisma` client, and is always called from inside an
 * existing `prisma.$transaction`). Recipients are resolved per event type -
 * "whose task just changed", per the ADR - and the actor is always
 * excluded, even on top of that. `ADMIN` is never a recipient of a workflow
 * event (mirrors ADR 0009: no ADMIN carve-out on sign-off).
 */

async function notify(
  tx: Prisma.TransactionClient,
  recipientIds: string[],
  actorId: string,
  type:
    | "TECH_PACK_VERSION_UPLOADED"
    | "TECH_PACK_REMARK_ADDED"
    | "TECH_PACK_VERSION_CONFIRMED"
    | "TECH_PACK_VERSION_APPROVED"
    | "TECH_PACK_VERSION_REJECTED"
    | "PROJECT_MEMBER_ADDED"
    | "PROJECT_MEMBER_REMOVED",
  message: string,
  link: string,
) {
  const recipients = [...new Set(recipientIds)].filter((id) => id !== actorId);
  if (recipients.length === 0) return;
  await notificationRepository.createMany(
    recipients.map((recipientId) => ({ recipientId, type, message, link })),
    tx,
  );
}

async function projectMemberIdsByRole(
  tx: Prisma.TransactionClient,
  projectId: string,
  role: "PRODUCT_DESIGNER" | "ENGINEERING",
): Promise<string[]> {
  const rows = await projectMemberRepository.findUserIdsByProjectAndRole(projectId, role, tx);
  return rows.map((row) => row.userId);
}

async function activeIdsByRole(
  tx: Prisma.TransactionClient,
  role: "MANAGEMENT" | "PMO",
): Promise<string[]> {
  const rows = await userRepository.findActiveIdsByRole(role, tx);
  return rows.map((row) => row.id);
}

// A new TechPack (v1) or a new version on an existing one - Engineering's
// task just appeared.
export async function notifyVersionUploaded(
  tx: Prisma.TransactionClient,
  actor: Actor,
  techPackId: string,
  techPackCode: string,
  projectId: string,
  versionNumber: number,
) {
  const recipients = await projectMemberIdsByRole(tx, projectId, "ENGINEERING");
  await notify(
    tx,
    recipients,
    actor.id,
    "TECH_PACK_VERSION_UPLOADED",
    `${techPackCode} v${versionNumber} is ready for review.`,
    `/tech-packs/${techPackId}`,
  );
}

// Remarks are a two-way thread between Engineering and the Product
// Designer - both sides of the project's team hear about a new one, not
// just the one whose "task" it creates.
export async function notifyRemarkAdded(
  tx: Prisma.TransactionClient,
  actor: Actor,
  techPackId: string,
  techPackCode: string,
  projectId: string,
  versionNumber: number,
) {
  // Sequential, not Promise.all - an interactive transaction holds a single
  // connection, and firing two queries on it concurrently races.
  const engineering = await projectMemberIdsByRole(tx, projectId, "ENGINEERING");
  const designers = await projectMemberIdsByRole(tx, projectId, "PRODUCT_DESIGNER");
  await notify(
    tx,
    [...engineering, ...designers],
    actor.id,
    "TECH_PACK_REMARK_ADDED",
    `New remarks on ${techPackCode} v${versionNumber}.`,
    `/tech-packs/${techPackId}`,
  );
}

// Engineering's confirmation resolves their own task and creates two new
// ones: Management's "Decide", and - since the Product Designer's work on
// this version is done either way - a heads-up for them too.
export async function notifyVersionConfirmed(
  tx: Prisma.TransactionClient,
  actor: Actor,
  techPackId: string,
  techPackCode: string,
  projectId: string,
  versionNumber: number,
) {
  const designers = await projectMemberIdsByRole(tx, projectId, "PRODUCT_DESIGNER");
  const management = await activeIdsByRole(tx, "MANAGEMENT");
  await notify(
    tx,
    [...designers, ...management],
    actor.id,
    "TECH_PACK_VERSION_CONFIRMED",
    `${techPackCode} v${versionNumber} was confirmed by Engineering.`,
    `/tech-packs/${techPackId}`,
  );
}

export async function notifyVersionApproved(
  tx: Prisma.TransactionClient,
  actor: Actor,
  protoRequestId: string,
  techPackCode: string,
  projectId: string,
  versionNumber: number,
) {
  const designers = await projectMemberIdsByRole(tx, projectId, "PRODUCT_DESIGNER");
  const pmo = await activeIdsByRole(tx, "PMO");
  await notify(
    tx,
    [...designers, ...pmo],
    actor.id,
    "TECH_PACK_VERSION_APPROVED",
    `${techPackCode} v${versionNumber} was approved.`,
    `/proto-requests/${protoRequestId}`,
  );
}

// Rejection voids the old TechPack and creates a successor with no
// versions yet - the Designer's "Upload v1" task on it, which this links
// straight to.
export async function notifyVersionRejected(
  tx: Prisma.TransactionClient,
  actor: Actor,
  successorTechPackId: string,
  oldTechPackCode: string,
  projectId: string,
) {
  const designers = await projectMemberIdsByRole(tx, projectId, "PRODUCT_DESIGNER");
  const pmo = await activeIdsByRole(tx, "PMO");
  await notify(
    tx,
    [...designers, ...pmo],
    actor.id,
    "TECH_PACK_VERSION_REJECTED",
    `${oldTechPackCode} was rejected and needs a new version.`,
    `/tech-packs/${successorTechPackId}`,
  );
}

// Takes a bare actor id, not the full `Actor` - `createProject`'s self-add
// only has the creator's id in scope, not their role, and nothing here
// needs the role (only `notify`'s actor-exclusion does).
export async function notifyMemberAdded(
  tx: Prisma.TransactionClient,
  actorId: string,
  projectId: string,
  projectCode: string,
  targetUserId: string,
) {
  await notify(
    tx,
    [targetUserId],
    actorId,
    "PROJECT_MEMBER_ADDED",
    `You were added to project ${projectCode}.`,
    `/projects/${projectId}`,
  );
}

// No link into the Project - ADR 0013 would 404 it the instant the removed
// user opened it, so this names the Project by code only.
export async function notifyMemberRemoved(
  tx: Prisma.TransactionClient,
  actorId: string,
  projectCode: string,
  targetUserId: string,
) {
  await notify(
    tx,
    [targetUserId],
    actorId,
    "PROJECT_MEMBER_REMOVED",
    `You were removed from project ${projectCode}.`,
    "/",
  );
}

// ---------------------------------------------------------------------------
// Read side - GET /me/notifications and friends. No visibility module
// involvement needed: a notification is already scoped to its recipient at
// creation time, there is nothing further to filter.
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 20;

export async function listForRecipient(actor: Actor, cursor?: string, limit = DEFAULT_PAGE_SIZE) {
  let cursorRow: { createdAt: Date; id: string } | undefined;
  if (cursor) {
    const row = await notificationRepository.findByIdAndRecipient(cursor, actor.id);
    if (!row) {
      throw new NotFoundError(`Notification ${cursor} not found`);
    }
    cursorRow = { createdAt: row.createdAt, id: row.id };
  }

  const items = await notificationRepository.findByRecipient(actor.id, {
    cursor: cursorRow,
    limit: limit + 1,
  });
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
}

export function countUnread(actor: Actor) {
  return notificationRepository.countUnread(actor.id);
}

export async function markRead(actor: Actor, id: string) {
  const notification = await notificationRepository.findByIdAndRecipient(id, actor.id);
  if (!notification) {
    throw new NotFoundError(`Notification ${id} not found`);
  }
  if (notification.readAt) return notification;
  return notificationRepository.markRead(id);
}

export async function markAllRead(actor: Actor) {
  await notificationRepository.markAllRead(actor.id);
}
