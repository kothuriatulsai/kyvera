import type { Prisma, ProtoWorkStatus } from "@prisma/client";
import * as protoWorkDeliveryConfirmationRepository from "../repositories/protoWorkDeliveryConfirmationRepository";
import * as protoWorkRepository from "../repositories/protoWorkRepository";
import * as protoWorkUpdateRepository from "../repositories/protoWorkUpdateRepository";
import * as userRepository from "../repositories/userRepository";
import { prisma } from "../repositories/prismaClient";
import * as notificationService from "./notificationService";
import type { Actor } from "./tokenService";
import * as visibility from "./visibility";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";

const MAX_UPDATE_BODY_LENGTH = 5000;

/**
 * ADR 0015, revised: once a Proto Work has an assigned Merchandiser, only
 * that person (not just any MERCHANDISER member of the Project) may
 * reconfirm the delivery date, post an update, or complete it. The
 * original decision ("workload-tracking metadata, not an access-control
 * boundary") was wrong in practice - a second Merchandiser on the same
 * Project could otherwise act on work that isn't theirs. ADMIN is still a
 * carve-in (it was never "assigned" in the first place, so it never
 * matches this check at all). Still `QUEUED` (nobody assigned yet) skips
 * this check entirely - "not yet assignable" is a 409 from the caller's own
 * business-rule check, not a 403, since no Merchandiser is the wrong one to
 * blame when nobody has been assigned.
 */
function assertIsAssignedMerchandiser(
  actor: Actor,
  protoWork: { assignedMerchandiserId: string | null },
) {
  if (
    actor.role === "MERCHANDISER" &&
    protoWork.assignedMerchandiserId !== null &&
    protoWork.assignedMerchandiserId !== actor.id
  ) {
    throw new ForbiddenError("Only the Merchandiser assigned to this Proto Work may do that");
  }
}

// ADR 0015, Stage 5 - no stage-level (layer B) restriction of its own, same
// precedent ADR 0013 already set for ProtoRequest: layer A only.
export async function listProtoWork(actor: Actor, projectId?: string, status?: ProtoWorkStatus) {
  const visibleIds = await visibility.visibleProjectIds(actor);
  const where: Prisma.ProtoWorkWhereInput = {};
  if (status) {
    where.status = status;
  }
  if (projectId) {
    if (visibleIds !== null && !visibleIds.includes(projectId)) {
      return [];
    }
    where.projectId = projectId;
  } else if (visibleIds !== null) {
    where.projectId = { in: visibleIds };
  }
  return protoWorkRepository.findMany(where);
}

export async function getProtoWork(actor: Actor, id: string) {
  const protoWork = await protoWorkRepository.findById(id);
  if (!protoWork) {
    throw new NotFoundError(`Proto Work ${id} not found`);
  }
  await visibility.assertProjectVisible(actor, protoWork.projectId);
  return protoWork;
}

// Step 20: PMO assigns from the Work Queue. The target must already be an
// active MERCHANDISER member of the Project - workload-tracking metadata
// (ADR 0015), but it still has to point at someone who can actually see
// this Project at all. Reassignment before completion is allowed (the SOP
// doesn't forbid it, and PMO may need to rebalance workload).
export async function assignMerchandiser(actor: Actor, protoWorkId: string, merchandiserId: string) {
  const scope = await protoWorkRepository.findScopeById(protoWorkId);
  if (!scope) {
    throw new NotFoundError(`Proto Work ${protoWorkId} not found`);
  }
  await visibility.assertProjectVisible(actor, scope.projectId);

  const target = await userRepository.findSafeById(merchandiserId);
  if (!target) {
    throw new NotFoundError(`User ${merchandiserId} not found`);
  }
  if (!target.isActive) {
    throw new ValidationError("Only an active user can be assigned to a Proto Work");
  }
  if (target.role !== "MERCHANDISER") {
    throw new ValidationError("Only a MERCHANDISER may be assigned to a Proto Work");
  }
  if (!(await visibility.isProjectMember(scope.projectId, merchandiserId))) {
    throw new ValidationError(`${target.name} must be a member of this Project before being assigned`);
  }

  return prisma.$transaction(async (tx) => {
    const protoWork = await protoWorkRepository.lockById(protoWorkId, tx);
    if (!protoWork) {
      throw new NotFoundError(`Proto Work ${protoWorkId} not found`);
    }
    if (protoWork.status === "COMPLETED") {
      throw new ConflictError(`Proto Work ${protoWork.code} is already completed`);
    }

    await protoWorkRepository.assign(protoWorkId, { merchandiserId, assignedById: actor.id }, tx);

    await notificationService.notifyProtoWorkAssigned(tx, actor, protoWorkId, protoWork.code, merchandiserId);

    return protoWorkRepository.findById(protoWorkId, tx);
  });
}

export interface AddDeliveryConfirmationInput {
  deliveryDate: Date;
  notes?: string;
}

// Step 22: the periodic delivery-date reconfirmation the SOP asks the
// system to prompt for. Deliberately no notification (ADR 0015/0014) - it
// resets only this merchandiser's own task clock, creating no one else's
// task, so it would be noise rather than signal.
export async function addDeliveryConfirmation(
  actor: Actor,
  protoWorkId: string,
  input: AddDeliveryConfirmationInput,
) {
  const scope = await protoWorkRepository.findScopeById(protoWorkId);
  if (!scope) {
    throw new NotFoundError(`Proto Work ${protoWorkId} not found`);
  }
  await visibility.assertProjectVisible(actor, scope.projectId);

  return prisma.$transaction(async (tx) => {
    const protoWork = await protoWorkRepository.lockById(protoWorkId, tx);
    if (!protoWork) {
      throw new NotFoundError(`Proto Work ${protoWorkId} not found`);
    }
    assertIsAssignedMerchandiser(actor, protoWork);
    if (protoWork.status === "COMPLETED") {
      throw new ConflictError(`Proto Work ${protoWork.code} is already completed`);
    }

    await protoWorkDeliveryConfirmationRepository.create(
      {
        protoWork: { connect: { id: protoWorkId } },
        deliveryDate: input.deliveryDate,
        confirmedBy: { connect: { id: actor.id } },
        notes: input.notes,
      },
      tx,
    );
    await protoWorkRepository.updateCurrentDeliveryDate(protoWorkId, input.deliveryDate, tx);

    return protoWorkRepository.findById(protoWorkId, tx);
  });
}

export interface AddProtoWorkUpdateInput {
  body: string;
}

// Step 21's "remarks/chat updates" - no notification either way (not in
// ADR 0014/0015's recipient table), so no transaction is needed here.
export async function addUpdate(actor: Actor, protoWorkId: string, input: AddProtoWorkUpdateInput) {
  const scope = await protoWorkRepository.findScopeById(protoWorkId);
  if (!scope) {
    throw new NotFoundError(`Proto Work ${protoWorkId} not found`);
  }
  await visibility.assertProjectVisible(actor, scope.projectId);
  assertIsAssignedMerchandiser(actor, scope);
  if (scope.status === "COMPLETED") {
    throw new ConflictError(`Proto Work ${protoWorkId} is already completed`);
  }

  const body = input.body.trim();
  if (body === "") {
    throw new ValidationError("body is required and must be a non-empty string");
  }
  if (body.length > MAX_UPDATE_BODY_LENGTH) {
    throw new ValidationError(`body must be at most ${MAX_UPDATE_BODY_LENGTH} characters`);
  }

  await protoWorkUpdateRepository.create({
    protoWork: { connect: { id: protoWorkId } },
    author: { connect: { id: actor.id } },
    body,
  });

  return getProtoWork(actor, protoWorkId);
}

// Step 23: must already be assigned to a merchandiser - matches the SOP's
// own sequencing (assign, then track, then complete) rather than letting a
// still-QUEUED ProtoWork skip straight to completed.
export async function completeProtoWork(actor: Actor, protoWorkId: string) {
  const scope = await protoWorkRepository.findScopeById(protoWorkId);
  if (!scope) {
    throw new NotFoundError(`Proto Work ${protoWorkId} not found`);
  }
  await visibility.assertProjectVisible(actor, scope.projectId);

  return prisma.$transaction(async (tx) => {
    const protoWork = await protoWorkRepository.lockById(protoWorkId, tx);
    if (!protoWork) {
      throw new NotFoundError(`Proto Work ${protoWorkId} not found`);
    }
    assertIsAssignedMerchandiser(actor, protoWork);
    if (protoWork.status === "COMPLETED") {
      throw new ConflictError(`Proto Work ${protoWork.code} is already completed`);
    }
    if (protoWork.status === "QUEUED") {
      throw new ConflictError(
        `Proto Work ${protoWork.code} must be assigned to a merchandiser before it can be completed`,
      );
    }

    await protoWorkRepository.complete(protoWorkId, actor.id, tx);

    await notificationService.notifyProtoWorkCompleted(tx, actor, protoWorkId, protoWork.code);

    return protoWorkRepository.findById(protoWorkId, tx);
  });
}
