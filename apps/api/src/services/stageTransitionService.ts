import type { ApprovalDecision } from "@prisma/client";
import * as approvalRepository from "../repositories/approvalRepository";
import * as assignmentRepository from "../repositories/assignmentRepository";
import * as productRepository from "../repositories/productRepository";
import * as productStageHistoryRepository from "../repositories/productStageHistoryRepository";
import * as productVersionRepository from "../repositories/productVersionRepository";
import * as stageDefinitionRepository from "../repositories/stageDefinitionRepository";
import * as userRepository from "../repositories/userRepository";
import { prisma } from "../repositories/prismaClient";
import { requireAccess, requireAuthority } from "./accessService";
import { diffInDays } from "./dateUtils";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";
import { recomputeAndPersistProductDelay } from "./productDelayService";
import type { Actor } from "./tokenService";

export type TransitionDirection = "forward" | "backward";

/**
 * An approval decision. There is no `decidedById`: the decider is the
 * authenticated actor (ADR 0005), never a claim in the request body.
 */
export interface ApprovalInput {
  decision: ApprovalDecision;
  notes?: string;
}

export interface TransitionProductInput {
  direction?: TransitionDirection;
  reason?: string;
  /** Who is responsible for the stage. Still a body field: no ADR resolves it. */
  responsibleUserId?: string;
  /** Required to move into the final (Approval) stage; rejected anywhere else. */
  approval?: ApprovalInput;
  /** Advance a multi-assignee stage even though not every assignee is ready. */
  force?: boolean;
}

/**
 * Moves a product one stage forward or back. Who may do what (ADR 0004):
 *
 * - Backward, approval decisions, and forcing a multi-assignee stage forward:
 *   admin, the product's owner, or a manager assigned to it ("full" access).
 * - Forward on a stage with several assignees: nothing fires automatically when
 *   the last assignee marks ready. Once all are ready someone with full access
 *   triggers it; if not all are ready they must pass `force`, which is recorded.
 * - Forward on a stage with exactly one assignee: that assignee can trigger it
 *   directly, as can anyone with full access.
 * - Anyone else, or a product they have no relationship to: 403 / 404.
 *
 * Returns nothing: callers project the product for the viewer themselves, since
 * an assignee who advances a stage must not get the whole product back.
 */
export async function transitionProduct(
  actor: Actor,
  productId: string,
  input: TransitionProductInput,
): Promise<void> {
  let direction = input.direction ?? "forward";
  let reason = input.reason;

  const { product, access } = await requireAccess(actor, productId);
  if (!product.currentStage) {
    throw new ConflictError(`Product ${productId} has no active stage to transition from`);
  }

  if (input.force) {
    if (direction !== "forward") {
      throw new ValidationError("force only applies to a forward transition");
    }
    requireAuthority(access, "force a transition");
  }

  // The approval gate is the final stage. Stages are data (ADR 0003), so it's
  // identified by position, not by looking for a stage named "Approval".
  const approvalStage = await stageDefinitionRepository.findLast();
  const entersApprovalStage =
    direction === "forward" &&
    approvalStage !== null &&
    product.currentStage.sequenceOrder + 1 === approvalStage.sequenceOrder;

  if (input.approval && !entersApprovalStage) {
    throw new ValidationError(
      "approval is only accepted on a forward transition into the final stage",
    );
  }
  if (entersApprovalStage) {
    // Checked before "a decision is required", so someone with no authority to
    // decide isn't told to go and supply one.
    requireAuthority(access, "move a product into approval");
    if (!input.approval) {
      throw new ValidationError(
        `An approval decision is required to move a product into ${approvalStage.name}`,
      );
    }
  }

  if (input.approval) {
    // A rejection is a backward transition, not a parallel code path: resolve
    // it to "backward" here and let everything below run unchanged, with the
    // rejection notes standing in as the required backward reason.
    if (input.approval.decision === "REJECTED") {
      if (!input.approval.notes?.trim()) {
        throw new ValidationError("notes are required when rejecting a product");
      }
      direction = "backward";
      reason = input.approval.notes;
    }
  }

  if (direction === "backward") {
    requireAuthority(access, "move a product backward");
    if (!reason?.trim()) {
      throw new ValidationError("reason is required when moving a product backward");
    }
  }

  // Sign-off on the stage being left. Only forward moves are gated by it.
  let forcedExit = false;
  if (direction === "forward") {
    const assignments = await assignmentRepository.findByProductAndStage(
      productId,
      product.currentStage.id,
    );
    const notReady = assignments.filter((a) => a.readyAt === null);

    if (access.full) {
      if (assignments.length > 1 && notReady.length > 0) {
        if (!input.force) {
          throw new ConflictError(
            `${notReady.length} of ${assignments.length} assignees have not marked this stage ready; ` +
              "pass force: true to advance anyway",
          );
        }
        forcedExit = true;
      }
    } else {
      const isSoleAssignee = assignments.length === 1 && assignments[0].userId === actor.id;
      if (!isSoleAssignee) {
        throw new ForbiddenError(
          assignments.length > 1
            ? "This stage has several assignees: mark yourself ready, and an admin, the " +
                "product's owner or an assigned manager advances it"
            : "Only the stage's assignee, or an admin, the product's owner or an assigned " +
                "manager, can advance it",
        );
      }
    }
  }

  const targetSequenceOrder =
    product.currentStage.sequenceOrder + (direction === "forward" ? 1 : -1);

  if (targetSequenceOrder < 1) {
    throw new ValidationError(`Product ${productId} is already at the first stage`);
  }

  const targetStage = await stageDefinitionRepository.findBySequenceOrder(targetSequenceOrder);
  if (!targetStage) {
    throw new ValidationError(`Product ${productId} is already at the final stage`);
  }

  if (input.responsibleUserId) {
    const responsibleUser = await userRepository.findById(input.responsibleUserId);
    if (!responsibleUser) {
      throw new ValidationError(
        `responsibleUserId ${input.responsibleUserId} does not reference an existing user`,
      );
    }
  }

  const currentStageId = product.currentStage.id;
  const currentStageExpectedDays = product.currentStage.expectedDurationDays;

  await prisma.$transaction(async (tx) => {
    const openEntry = await productStageHistoryRepository.findOpenEntry(
      productId,
      currentStageId,
      tx,
    );
    if (!openEntry) {
      throw new ConflictError(
        `No active stage history entry found for product ${productId}'s current stage`,
      );
    }

    const now = new Date();
    const actualDurationDays = diffInDays(openEntry.enteredAt, now);

    await productStageHistoryRepository.closeEntry(
      openEntry.id,
      {
        exitedAt: now,
        actualDurationDays,
        delayed: actualDurationDays > currentStageExpectedDays,
        delayReason: reason,
        responsibleUser: input.responsibleUserId
          ? { connect: { id: input.responsibleUserId } }
          : undefined,
        // The person who pressed the button, so a transition is always attributed
        // to someone who decided it (ADR 0004, Resolution 8).
        exitedBy: { connect: { id: actor.id } },
        forcedExit,
      },
      tx,
    );

    await productStageHistoryRepository.create(
      {
        product: { connect: { id: productId } },
        stage: { connect: { id: targetStage.id } },
        responsibleUser: input.responsibleUserId
          ? { connect: { id: input.responsibleUserId } }
          : undefined,
      },
      tx,
    );

    await productRepository.update(
      productId,
      { currentStage: { connect: { id: targetStage.id } } },
      tx,
    );

    // A visit to a stage gets its own sign-off: marks left over from an earlier
    // visit (a rework loop) must not count as ready for this one.
    await assignmentRepository.clearReady(productId, targetStage.id, tx);

    if (input.approval && approvalStage) {
      // Pin the decision to the exact version being decided on, so Module 2
      // can ask "is *this* version approved" rather than "is this product".
      const version = await productVersionRepository.findByProductAndNumber(
        productId,
        product.currentVersion,
        tx,
      );
      if (!version) {
        throw new ConflictError(
          `Product ${productId} has no version ${product.currentVersion} to approve`,
        );
      }

      await approvalRepository.create(
        {
          product: { connect: { id: productId } },
          productVersion: { connect: { id: version.id } },
          stage: { connect: { id: approvalStage.id } },
          decision: input.approval.decision,
          decidedBy: { connect: { id: actor.id } },
          notes: input.approval.notes,
        },
        tx,
      );
    }

    await recomputeAndPersistProductDelay(productId, tx);
  });
}
