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

interface StageWindowRow {
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
  stageDefs: StageWindowRow[],
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
 * `computeLiveDelays` / `liveDelayFields`.
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
  /** Projected from live stage timing - unlike the stored column, never stale. */
  expectedCompletionDate: Date;
}

export type StageDefinitionRow = Awaited<ReturnType<typeof stageDefinitionRepository.findAll>>[number];
export type StageHistoryRowFull = Awaited<
  ReturnType<typeof productStageHistoryRepository.findAllByProducts>
>[number];

/**
 * Everything computed from the *full* stage history of a set of products: the
 * stage definitions, each product's complete history, and its live delay
 * result. Viewer projections (docs/architecture/0004) are built on top of this
 * and only ever filter what is *shown* - the computation itself always runs over
 * the whole workflow, otherwise an assignee's view would get wrong dates.
 *
 * Batched: one query for the stage definitions and one for every product's
 * history, then the same pure `computeProductDelay` per product in memory.
 */
export interface LiveDelayContext {
  stageDefs: StageDefinitionRow[];
  historyByProduct: Map<string, StageHistoryRowFull[]>;
  delayByProduct: Map<string, DelayComputationResult>;
}

export async function computeLiveDelays(
  products: { id: string; startDate: Date | null; createdAt: Date }[],
  db: Db = prisma,
): Promise<LiveDelayContext> {
  const context: LiveDelayContext = {
    stageDefs: [],
    historyByProduct: new Map(),
    delayByProduct: new Map(),
  };
  if (products.length === 0) return context;

  const [stageDefs, history] = await Promise.all([
    stageDefinitionRepository.findAll(db),
    productStageHistoryRepository.findAllByProducts(
      products.map((p) => p.id),
      db,
    ),
  ]);
  context.stageDefs = stageDefs;

  for (const entry of history) {
    const rows = context.historyByProduct.get(entry.productId) ?? [];
    rows.push(entry);
    context.historyByProduct.set(entry.productId, rows);
  }

  const referenceDate = new Date();
  for (const product of products) {
    context.delayByProduct.set(
      product.id,
      computeProductDelay({
        ...toDelayInput(product, stageDefs, context.historyByProduct.get(product.id) ?? []),
        referenceDate,
      }),
    );
  }

  return context;
}

/**
 * The live `status` and `delay` summary for a product a viewer is allowed to
 * see in full. `products.status` is only persisted on create/transition, so
 * reads never trust it (except BLOCKED, which is manual).
 */
export function liveDelayFields(
  storedStatus: ProductStatus,
  result: DelayComputationResult,
): { status: ProductStatus; delay: LiveDelaySummary } {
  return {
    status: deriveStatus(storedStatus, result.delayed),
    delay: {
      delayed: result.delayed,
      totalDelayDays: result.totalDelayDays,
      expectedCompletionDate: result.expectedCompletionDate,
    },
  };
}
