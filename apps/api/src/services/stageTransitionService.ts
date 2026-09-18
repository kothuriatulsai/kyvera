import * as productRepository from "../repositories/productRepository";
import * as productStageHistoryRepository from "../repositories/productStageHistoryRepository";
import * as stageDefinitionRepository from "../repositories/stageDefinitionRepository";
import * as userRepository from "../repositories/userRepository";
import { prisma } from "../repositories/prismaClient";
import { diffInDays } from "./dateUtils";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { recomputeAndPersistProductDelay } from "./productDelayService";

export type TransitionDirection = "forward" | "backward";

export interface TransitionProductInput {
  direction?: TransitionDirection;
  reason?: string;
  responsibleUserId?: string;
}

export async function transitionProduct(productId: string, input: TransitionProductInput) {
  const direction = input.direction ?? "forward";

  const product = await productRepository.findByIdWithCurrentStage(productId);
  if (!product) {
    throw new NotFoundError(`Product ${productId} not found`);
  }
  if (!product.currentStage) {
    throw new ConflictError(`Product ${productId} has no active stage to transition from`);
  }

  if (direction === "backward" && !input.reason?.trim()) {
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
        delayReason: input.reason,
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

    await recomputeAndPersistProductDelay(productId, tx);

    return productRepository.findById(productId, tx);
  });
}
