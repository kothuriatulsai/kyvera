import type { ApprovalDecision } from "@prisma/client";
import * as approvalRepository from "../repositories/approvalRepository";
import * as productRepository from "../repositories/productRepository";
import * as productStageHistoryRepository from "../repositories/productStageHistoryRepository";
import * as productVersionRepository from "../repositories/productVersionRepository";
import * as stageDefinitionRepository from "../repositories/stageDefinitionRepository";
import * as userRepository from "../repositories/userRepository";
import { prisma } from "../repositories/prismaClient";
import { diffInDays } from "./dateUtils";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { recomputeAndPersistProductDelay } from "./productDelayService";

export type TransitionDirection = "forward" | "backward";

export interface ApprovalInput {
  decision: ApprovalDecision;
  decidedById: string;
  notes?: string;
}

export interface TransitionProductInput {
  direction?: TransitionDirection;
  reason?: string;
  responsibleUserId?: string;
  /** Required to move into the final (Approval) stage; rejected anywhere else. */
  approval?: ApprovalInput;
}

// Same authority level as other gated stage movement (docs/architecture/0005).
const APPROVER_ROLES = ["ADMIN", "MANAGER"];

async function assertCanDecide(decidedById: string) {
  const user = await userRepository.findById(decidedById);
  if (!user) {
    throw new ValidationError(`decidedById ${decidedById} does not reference an existing user`);
  }
  if (!APPROVER_ROLES.includes(user.role)) {
    throw new ForbiddenError("Only an admin or manager can submit an approval decision");
  }
}

export async function transitionProduct(productId: string, input: TransitionProductInput) {
  let direction = input.direction ?? "forward";
  let reason = input.reason;

  const product = await productRepository.findByIdWithCurrentStage(productId);
  if (!product) {
    throw new NotFoundError(`Product ${productId} not found`);
  }
  if (!product.currentStage) {
    throw new ConflictError(`Product ${productId} has no active stage to transition from`);
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
  if (entersApprovalStage && !input.approval) {
    throw new ValidationError(
      `An approval decision is required to move a product into ${approvalStage.name}`,
    );
  }

  if (input.approval) {
    await assertCanDecide(input.approval.decidedById);

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

  if (direction === "backward" && !reason?.trim()) {
    throw new ValidationError("reason is required when moving a product backward");
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

  return prisma.$transaction(async (tx) => {
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
          decidedBy: { connect: { id: input.approval.decidedById } },
          notes: input.approval.notes,
        },
        tx,
      );
    }

    await recomputeAndPersistProductDelay(productId, tx);

    return productRepository.findById(productId, tx);
  });
}
