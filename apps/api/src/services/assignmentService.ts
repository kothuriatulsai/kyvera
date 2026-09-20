import { Prisma } from "@prisma/client";
import * as assignmentHistoryRepository from "../repositories/assignmentHistoryRepository";
import * as assignmentRepository from "../repositories/assignmentRepository";
import * as productRepository from "../repositories/productRepository";
import * as progressNoteRepository from "../repositories/progressNoteRepository";
import * as stageDefinitionRepository from "../repositories/stageDefinitionRepository";
import * as userRepository from "../repositories/userRepository";
import { prisma } from "../repositories/prismaClient";
import { requireAccess } from "./accessService";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import type { Actor } from "./tokenService";

const MAX_NOTE_LENGTH = 2000;

// Assignments decide who can see what, so changing them is an admin action
// (ADR 0004). Checked before anything is loaded, so a non-admin learns nothing
// about which products or users exist.
function requireAdmin(actor: Actor) {
  if (actor.role !== "ADMIN") {
    throw new ForbiddenError("Only an admin can manage stage assignments");
  }
}

export interface AssignUserInput {
  stageId: string;
  userId: string;
}

export async function assignUser(actor: Actor, productId: string, input: AssignUserInput) {
  requireAdmin(actor);

  const [product, stage, user] = await Promise.all([
    productRepository.findByIdWithCurrentStage(productId),
    stageDefinitionRepository.findById(input.stageId),
    userRepository.findById(input.userId),
  ]);
  if (!product) throw new NotFoundError(`Product ${productId} not found`);
  if (!stage) throw new ValidationError(`stageId ${input.stageId} does not reference a stage`);
  if (!user) throw new ValidationError(`userId ${input.userId} does not reference an existing user`);

  try {
    return await prisma.$transaction(async (tx) => {
      const assignment = await assignmentRepository.create(
        {
          product: { connect: { id: productId } },
          stage: { connect: { id: stage.id } },
          user: { connect: { id: user.id } },
          assignedBy: { connect: { id: actor.id } },
        },
        tx,
      );
      await assignmentHistoryRepository.create(
        {
          product: { connect: { id: productId } },
          stage: { connect: { id: stage.id } },
          user: { connect: { id: user.id } },
          action: "ASSIGNED",
          actedBy: { connect: { id: actor.id } },
        },
        tx,
      );
      return assignment;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("That user is already assigned to that stage of this product");
    }
    throw err;
  }
}

export async function unassignUser(actor: Actor, productId: string, assignmentId: string) {
  requireAdmin(actor);

  const assignment = await assignmentRepository.findById(assignmentId);
  if (!assignment || assignment.productId !== productId) {
    throw new NotFoundError(`Assignment ${assignmentId} not found`);
  }

  await prisma.$transaction(async (tx) => {
    await assignmentRepository.remove(assignment.id, tx);
    await assignmentHistoryRepository.create(
      {
        product: { connect: { id: productId } },
        stage: { connect: { id: assignment.stageId } },
        user: { connect: { id: assignment.userId } },
        action: "UNASSIGNED",
        actedBy: { connect: { id: actor.id } },
      },
      tx,
    );
  });
}

/**
 * An assignee's own "I'm done with this stage" mark. It targets an assignment
 * row, and only the row's own user may set it - not an admin, not a colleague
 * on the same stage (an admin who wants to move on without someone's sign-off
 * forces the transition instead). It never moves the product.
 */
export async function markAssignmentReady(actor: Actor, productId: string, assignmentId: string) {
  const { product } = await requireAccess(actor, productId);

  const assignment = await assignmentRepository.findById(assignmentId);
  if (!assignment || assignment.productId !== productId) {
    throw new NotFoundError(`Assignment ${assignmentId} not found`);
  }
  if (assignment.userId !== actor.id) {
    throw new ForbiddenError("You can only mark your own assignment ready");
  }
  if (product.currentStageId !== assignment.stageId) {
    throw new ConflictError("Only the product's current stage can be marked ready");
  }

  // Idempotent: keep the original timestamp rather than moving it.
  const updated = assignment.readyAt
    ? assignment
    : await assignmentRepository.markReady(assignment.id, new Date());

  return { assignmentId: updated.id, stageId: updated.stageId, readyAt: updated.readyAt as Date };
}

/**
 * A progress or delay note on a stage the actor is assigned to. Available at
 * any time - not only while the product is in that stage - and never moves the
 * product (ADR 0004, Resolution 2).
 */
export async function addProgressNote(
  actor: Actor,
  productId: string,
  stageId: string,
  rawNote: string,
) {
  await requireAccess(actor, productId);

  const [assignment] = await assignmentRepository.findByProductAndStage(productId, stageId).then(
    (rows) => rows.filter((a) => a.userId === actor.id),
  );
  if (!assignment) {
    throw new ForbiddenError("Only an assignee of this stage can add a progress note to it");
  }

  const note = rawNote.trim();
  if (note.length === 0) throw new ValidationError("note must not be empty");
  if (note.length > MAX_NOTE_LENGTH) {
    throw new ValidationError(`note must be at most ${MAX_NOTE_LENGTH} characters`);
  }

  const created = await progressNoteRepository.create({
    product: { connect: { id: productId } },
    stage: { connect: { id: stageId } },
    user: { connect: { id: actor.id } },
    note,
  });

  return { id: created.id, stageId, note: created.note, createdAt: created.createdAt };
}
