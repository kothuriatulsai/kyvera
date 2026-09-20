import * as productRepository from "../repositories/productRepository";
import * as progressNoteRepository from "../repositories/progressNoteRepository";
import {
  determineAccess,
  requireAccess,
  visibleProductsWhere,
  type AccessLevel,
} from "./accessService";
import type { DelayComputationResult } from "./delayComputationService";
import { NotFoundError } from "./errors";
import {
  computeLiveDelays,
  liveDelayFields,
  type LiveDelayContext,
  type StageHistoryRowFull,
} from "./productDelayService";
import { computeReadiness, type ReadinessHint } from "./readinessService";
import type { Actor } from "./tokenService";

/**
 * The one place a product is turned into a response for a particular viewer
 * (docs/architecture/0004). Every read - and every write that returns a product
 * - goes through here, so what a viewer may see is decided once, not per
 * endpoint.
 *
 * Two shapes, chosen by the viewer's access to *that product*:
 *
 * - `full` (admin, owner, assigned manager): the whole product.
 * - `assignee`: only the viewer's own assigned stages, each with a readiness
 *   hint. No other stage's name, status or history, no product-level status,
 *   dates, owner, versions or approvals - and nothing about other users.
 *
 * Whatever is *computed* (delay, readiness) always runs over the full history;
 * only the output is narrowed. Otherwise an assignee's dates would be wrong.
 */
export type FullAccessLevel = Exclude<AccessLevel, "ASSIGNEE">;

export interface AssigneeStageDelay {
  durationDays: number;
  expectedDurationDays: number;
  delayDays: number;
  delayed: boolean;
}

export interface AssigneeStageView {
  assignmentId: string;
  stage: { id: string; name: string; expectedDurationDays: number };
  readyAt: Date | null;
  readiness: ReadinessHint;
  delay: AssigneeStageDelay | null;
}

export interface AssigneeStageDetail extends AssigneeStageView {
  history: {
    enteredAt: Date;
    exitedAt: Date | null;
    actualDurationDays: number | null;
    delayed: boolean;
    delayReason: string | null;
  }[];
  /** Notes on this stage. Authors are not named: only whether a note is yours. */
  notes: { id: string; note: string; createdAt: Date; isMine: boolean }[];
}

interface AssigneeProductBase {
  view: "assignee";
  access: "ASSIGNEE";
  id: string;
  name: string;
  description: string | null;
}

export interface AssigneeProductSummary extends AssigneeProductBase {
  stages: AssigneeStageView[];
}

export interface AssigneeProductDetail extends AssigneeProductBase {
  stages: AssigneeStageDetail[];
}

type ViewerProduct = Awaited<ReturnType<typeof productRepository.findManyForViewer>>[number];

interface OwnAssignment {
  id: string;
  stageId: string;
  readyAt: Date | null;
  stage: { id: string; name: string; sequenceOrder: number; expectedDurationDays: number };
}

function assigneeStages(
  product: {
    currentStageId: string | null;
    currentStage: { sequenceOrder: number } | null;
  },
  ownAssignments: OwnAssignment[],
  context: LiveDelayContext,
  productId: string,
): AssigneeStageView[] {
  const history = context.historyByProduct.get(productId) ?? [];
  const delay = context.delayByProduct.get(productId);

  // When the product entered its current stage: what "opens in ~N days" counts from.
  const openEntry = [...history]
    .reverse()
    .find((h) => h.exitedAt === null && h.stageId === product.currentStageId);

  return [...ownAssignments]
    .sort((a, b) => a.stage.sequenceOrder - b.stage.sequenceOrder)
    .map((assignment) => {
      const stageDelay = delay?.stages.find((s) => s.sequenceOrder === assignment.stage.sequenceOrder);
      return {
        assignmentId: assignment.id,
        stage: {
          id: assignment.stage.id,
          name: assignment.stage.name,
          expectedDurationDays: assignment.stage.expectedDurationDays,
        },
        readyAt: assignment.readyAt,
        readiness: computeReadiness({
          stages: context.stageDefs,
          currentSequenceOrder: product.currentStage?.sequenceOrder ?? null,
          currentEnteredAt: openEntry?.enteredAt ?? null,
          targetSequenceOrder: assignment.stage.sequenceOrder,
        }),
        // `status` is left out on purpose: readiness already says where the stage
        // stands, and a "completed" status could contradict it after a rework loop.
        delay: stageDelay
          ? {
              durationDays: stageDelay.durationDays,
              expectedDurationDays: stageDelay.expectedDurationDays,
              delayDays: stageDelay.delayDays,
              delayed: stageDelay.delayed,
            }
          : null,
      };
    });
}

function withoutOwnAssignments<T extends { assignments: unknown }>(product: T): Omit<T, "assignments"> {
  const { assignments, ...rest } = product;
  void assignments;
  return rest;
}

function toFullListEntry(
  product: ViewerProduct,
  level: FullAccessLevel,
  delay: DelayComputationResult,
) {
  return {
    ...withoutOwnAssignments(product),
    view: "full" as const,
    access: level,
    ...liveDelayFields(product.status, delay),
  };
}

export type FullListEntry = ReturnType<typeof toFullListEntry>;
export type ProductListEntry = FullListEntry | AssigneeProductSummary;

async function buildListEntries(actor: Actor, products: ViewerProduct[]) {
  const context = await computeLiveDelays(products);
  const entries: ProductListEntry[] = [];

  for (const product of products) {
    const access = determineAccess(
      actor,
      product.ownerId,
      product.assignments.map((a) => a.stageId),
    );
    if (!access) continue; // unreachable for rows fetched with visibleProductsWhere

    if (access.full) {
      const delay = context.delayByProduct.get(product.id) as DelayComputationResult;
      entries.push(toFullListEntry(product, access.level as FullAccessLevel, delay));
    } else {
      entries.push({
        view: "assignee",
        access: "ASSIGNEE",
        id: product.id,
        name: product.name,
        description: product.description,
        stages: assigneeStages(product, product.assignments, context, product.id),
      });
    }
  }
  return entries;
}

export function listProductViews(actor: Actor) {
  return productRepository
    .findManyForViewer(visibleProductsWhere(actor), actor.id)
    .then((products) => buildListEntries(actor, products));
}

/** A single product in the list shape (what PATCH returns). */
export async function getProductSummaryView(actor: Actor, productId: string) {
  const products = await productRepository.findManyForViewer(
    { AND: [visibleProductsWhere(actor), { id: productId }] },
    actor.id,
  );
  const [entry] = await buildListEntries(actor, products);
  if (!entry) throw new NotFoundError(`Product ${productId} not found`);
  return entry;
}

export async function getProductDetailView(actor: Actor, productId: string) {
  const { product, access, ownAssignments } = await requireAccess(actor, productId);

  if (access.full) {
    const detail = await productRepository.findById(productId);
    if (!detail) throw new NotFoundError(`Product ${productId} not found`);

    const context = await computeLiveDelays([detail]);
    const delay = context.delayByProduct.get(productId) as DelayComputationResult;
    return {
      ...detail,
      view: "full" as const,
      access: access.level as FullAccessLevel,
      ...liveDelayFields(detail.status, delay),
    };
  }

  // Assignee: load only what they may see. Versions, approvals and other
  // people's assignments are never fetched; the full history is, because the
  // computation needs it, but none of it is returned except their own stages.
  const context = await computeLiveDelays([product]);
  const stageIds = ownAssignments.map((a) => a.stageId);
  const [stages, notes] = await Promise.all([
    Promise.resolve(assigneeStages(product, ownAssignments, context, productId)),
    progressNoteRepository.findByProductAndStages(productId, stageIds),
  ]);

  const history: StageHistoryRowFull[] = context.historyByProduct.get(productId) ?? [];

  const detail: AssigneeProductDetail = {
    view: "assignee",
    access: "ASSIGNEE",
    id: product.id,
    name: product.name,
    description: product.description,
    stages: stages.map((stage) => ({
      ...stage,
      history: history
        .filter((h) => h.stageId === stage.stage.id)
        .map((h) => ({
          enteredAt: h.enteredAt,
          exitedAt: h.exitedAt,
          actualDurationDays: h.actualDurationDays,
          delayed: h.delayed,
          delayReason: h.delayReason,
        })),
      notes: notes
        .filter((n) => n.stageId === stage.stage.id)
        .map((n) => ({
          id: n.id,
          note: n.note,
          createdAt: n.createdAt,
          isMine: n.userId === actor.id,
        })),
    })),
  };
  return detail;
}

export async function getDelayView(actor: Actor, productId: string) {
  const { product, access, ownAssignments } = await requireAccess(actor, productId);
  const context = await computeLiveDelays([product]);
  const delay = context.delayByProduct.get(productId) as DelayComputationResult;

  if (access.full) {
    return { view: "full" as const, ...delay };
  }
  return {
    view: "assignee" as const,
    stages: assigneeStages(product, ownAssignments, context, productId),
  };
}

/**
 * What a creator gets back. Creating a product doesn't make you its owner (the
 * owner is a request field), so a creator may end up with no relationship to
 * it - in which case they only get the id and name they supplied, not the
 * product (which would include another user's details).
 */
export async function getCreatedProductView(
  actor: Actor,
  product: { id: string; name: string },
) {
  try {
    return await getProductDetailView(actor, product.id);
  } catch (err) {
    if (err instanceof NotFoundError) return { id: product.id, name: product.name };
    throw err;
  }
}
