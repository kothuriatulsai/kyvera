import type { Prisma } from "@prisma/client";
import type { Db } from "../repositories/prismaClient";
import { prisma } from "../repositories/prismaClient";
import * as assignmentRepository from "../repositories/assignmentRepository";
import * as productRepository from "../repositories/productRepository";
import { ForbiddenError, NotFoundError } from "./errors";
import type { Actor } from "./tokenService";

/**
 * The single answer to "who is this actor, to this product?" (ADR 0004).
 * Visibility and authority are deliberately the same boundary, so there is no
 * second access model to keep in sync with the first:
 *
 * - ADMIN: every product, unscoped.
 * - OWNER: the products they own, in full.
 * - MANAGER: a manager who is assigned to the product, in full. Being a
 *   manager alone grants nothing - assignment, not role, gates visibility.
 * - ASSIGNEE: anyone else assigned to at least one stage of the product; sees
 *   only their own stages.
 *
 * Anyone else has no relationship to the product and it does not exist for them.
 */
export type AccessLevel = "ADMIN" | "OWNER" | "MANAGER" | "ASSIGNEE";

export interface ProductAccess {
  level: AccessLevel;
  /**
   * Sees the whole product AND holds authority over it: force or reverse a
   * transition, trigger a fully signed-off one, decide an approval, edit or
   * delete it. True for ADMIN, OWNER and MANAGER; false for ASSIGNEE.
   */
  full: boolean;
  /** Stages the actor is assigned to on this product, whatever their level. */
  assignedStageIds: string[];
}

export function determineAccess(
  actor: Actor,
  ownerId: string,
  actorAssignedStageIds: string[],
): ProductAccess | null {
  const assigned = actorAssignedStageIds;

  if (actor.role === "ADMIN") return { level: "ADMIN", full: true, assignedStageIds: assigned };
  if (ownerId === actor.id) return { level: "OWNER", full: true, assignedStageIds: assigned };
  if (assigned.length === 0) return null;
  if (actor.role === "MANAGER") return { level: "MANAGER", full: true, assignedStageIds: assigned };
  return { level: "ASSIGNEE", full: false, assignedStageIds: assigned };
}

/**
 * The same rule as `determineAccess`, as a query: which products an actor may
 * see at all. A product with no relationship to the actor is left out of lists
 * entirely - not returned and then filtered.
 */
export function visibleProductsWhere(actor: Actor): Prisma.ProductWhereInput {
  if (actor.role === "ADMIN") return {};
  return { OR: [{ ownerId: actor.id }, { assignments: { some: { userId: actor.id } } }] };
}

/** Like `visibleProductsWhere`, but only the products the actor sees in full. */
export function fullAccessProductsWhere(actor: Actor): Prisma.ProductWhereInput {
  if (actor.role === "ADMIN") return {};
  const owned: Prisma.ProductWhereInput = { ownerId: actor.id };
  if (actor.role !== "MANAGER") return owned;
  return { OR: [owned, { assignments: { some: { userId: actor.id } } }] };
}

export function hasFullAccessToAnyProduct(actor: Actor, db: Db = prisma): Promise<boolean> {
  return productRepository.existsWhere(fullAccessProductsWhere(actor), db);
}

/**
 * Loads the product and works out the actor's access to it. A product the actor
 * has no relationship to is reported exactly like one that doesn't exist (404,
 * same message), so a caller can't probe which ids are real.
 */
export async function requireAccess(actor: Actor, productId: string, db: Db = prisma) {
  const product = await productRepository.findByIdWithCurrentStage(productId, db);
  const ownAssignments = product
    ? await assignmentRepository.findByProductAndUser(productId, actor.id, db)
    : [];

  const access = product
    ? determineAccess(
        actor,
        product.ownerId,
        ownAssignments.map((a) => a.stageId),
      )
    : null;

  if (!product || !access) {
    throw new NotFoundError(`Product ${productId} not found`);
  }
  return { product, access, ownAssignments };
}

/** Throws 403 unless the actor holds authority (i.e. sees the product in full). */
export function requireAuthority(access: ProductAccess, action: string): void {
  if (!access.full) {
    throw new ForbiddenError(
      `Only an admin, the product's owner, or a manager assigned to it can ${action}`,
    );
  }
}
