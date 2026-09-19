import type { ProductStatus } from "@prisma/client";
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

interface StageDefinitionRow {
  sequenceOrder: number;
  expectedDurationDays: number;
}

interface StageHistoryRow {
  stage: { sequenceOrder: number };
  enteredAt: Date;
  exitedAt: Date | null;
  actualDurationDays: number | null;
}

/** Adapts DB rows into the pure computation's input shape. */
function toDelayInput(
  product: { startDate: Date | null; createdAt: Date },
  stageDefs: StageDefinitionRow[],
  history: StageHistoryRow[],
): DelayComputationInput {
  return {
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
  };
}

/**
 * The one place that decides a product's status from its delay. BLOCKED is a
 * manually-set state and always wins; otherwise status simply follows delay.
 * Used both when persisting a recompute and when computing status live for
 * reads, so the two can never disagree.
 */
export function deriveStatus(stored: ProductStatus, delayed: boolean): ProductStatus {
  if (stored === "BLOCKED") return "BLOCKED";
  return delayed ? "DELAYED" : "ON_TRACK";
}

async function buildDelayInput(productId: string, db: Db): Promise<{
  status: ProductStatus;
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

  return { status: product.status, input: toDelayInput(product, stageDefs, history) };
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
 * on every transition. Reads don't rely on this snapshot for `status`: see
 * `withLiveDelay`.
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
      status: deriveStatus(status, result.delayed),
    },
    db,
  );

  return result;
}

export interface LiveDelaySummary {
  delayed: boolean;
  totalDelayDays: number;
  /** Projected from live stage timing — unlike the stored column, never stale. */
  expectedCompletionDate: Date;
}

export type WithLiveDelay<T> = Omit<T, "status"> & {
  status: ProductStatus;
  delay: LiveDelaySummary;
};

/**
 * Overlays live-computed `status` and a `delay` summary onto products for
 * reads. `products.status` is only persisted when a product is created or
 * transitioned, so a product that has since overrun its current stage would
 * otherwise read ON_TRACK. Batched: one query for the stage definitions and
 * one for every product's history, then the same pure `computeProductDelay`
 * per product in memory — not a query per product.
 */
export async function withLiveDelay<
  T extends { id: string; status: ProductStatus; startDate: Date | null; createdAt: Date },
>(products: T[], db: Db = prisma): Promise<WithLiveDelay<T>[]> {
  if (products.length === 0) return [];

  const [stageDefs, history] = await Promise.all([
    stageDefinitionRepository.findAll(db),
    productStageHistoryRepository.findAllByProducts(
      products.map((p) => p.id),
      db,
    ),
  ]);

  const historyByProduct = new Map<string, typeof history>();
  for (const entry of history) {
    const rows = historyByProduct.get(entry.productId) ?? [];
    rows.push(entry);
    historyByProduct.set(entry.productId, rows);
  }

  const referenceDate = new Date();

  return products.map((product) => {
    const result = computeProductDelay({
      ...toDelayInput(product, stageDefs, historyByProduct.get(product.id) ?? []),
      referenceDate,
    });

    return {
      ...product,
      status: deriveStatus(product.status, result.delayed),
      delay: {
        delayed: result.delayed,
        totalDelayDays: result.totalDelayDays,
        expectedCompletionDate: result.expectedCompletionDate,
      },
    };
  });
}
