import type { Db } from "../repositories/prismaClient";
import { prisma } from "../repositories/prismaClient";
import * as productRepository from "../repositories/productRepository";
import * as productStageHistoryRepository from "../repositories/productStageHistoryRepository";
import * as stageDefinitionRepository from "../repositories/stageDefinitionRepository";
import {
  computeProductDelay,
  type DelayComputationInput,
  type DelayComputationResult,
} from "./delayComputationService";
import { NotFoundError } from "./errors";

async function buildDelayInput(productId: string, db: Db): Promise<{
  status: string;
  input: DelayComputationInput;
}> {
  const product = await productRepository.findByIdWithCurrentStage(productId, db);
  if (!product) {
    throw new NotFoundError(`Product ${productId} not found`);
  }

  const [stageDefs, history] = await Promise.all([
    stageDefinitionRepository.findAll(db),
    productStageHistoryRepository.findAllByProduct(productId, db),
  ]);

  return {
    status: product.status,
    input: {
      startDate: product.startDate ?? product.createdAt,
      stages: stageDefs.map((stage) => ({
        sequenceOrder: stage.sequenceOrder,
        expectedDurationDays: stage.expectedDurationDays,
      })),
      history: history.map((entry) => ({
        stageSequenceOrder: entry.stage.sequenceOrder,
        enteredAt: entry.enteredAt,
        exitedAt: entry.exitedAt,
        actualDurationDays: entry.actualDurationDays,
      })),
    },
  };
}

export async function computeDelayForProduct(
  productId: string,
  db: Db = prisma,
): Promise<DelayComputationResult> {
  const { input } = await buildDelayInput(productId, db);
  return computeProductDelay(input);
}

/**
 * Recomputes the cascading projection and persists it onto the product row
 * (`expectedCompletionDate`, and `status` unless it's been manually set to
 * BLOCKED). Called wherever a stage's timing just changed — on creation and
 * on every transition — so `products.expected_completion_date` is never a
 * stale, manually-set value.
 */
export async function recomputeAndPersistProductDelay(
  productId: string,
  db: Db = prisma,
): Promise<DelayComputationResult> {
  const { status, input } = await buildDelayInput(productId, db);
  const result = computeProductDelay(input);

  await productRepository.update(
    productId,
    {
      expectedCompletionDate: result.expectedCompletionDate,
      status: status === "BLOCKED" ? undefined : result.delayed ? "DELAYED" : "ON_TRACK",
    },
    db,
  );

  return result;
}
