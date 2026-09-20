import type { Request, Response } from "express";
import { ApprovalDecision, ProductStatus } from "@prisma/client";
import { requireActor } from "../middleware/authenticate";
import * as productService from "../services/productService";
import * as productViewService from "../services/productViewService";
import * as stageTransitionService from "../services/stageTransitionService";
import type { ApprovalInput } from "../services/stageTransitionService";
import { ValidationError } from "../services/errors";
import { asyncHandler } from "./asyncHandler";
import { nullableDate, optionalDate, optionalString, requireString } from "./requestParsing";

function optionalApproval(body: Record<string, unknown>): ApprovalInput | undefined {
  const raw = body.approval;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("approval must be an object");
  }
  const approval = raw as Record<string, unknown>;

  // The decider is the authenticated user (ADR 0005), never a claim in the body.
  // Reject rather than silently ignore, so a client still sending it finds out.
  if (approval.decidedById !== undefined) {
    throw new ValidationError(
      "decidedById is not accepted: the decision is attributed to the authenticated user",
    );
  }

  const decision = requireString(approval, "decision");
  if (!Object.values(ApprovalDecision).includes(decision as ApprovalDecision)) {
    throw new ValidationError(
      `decision must be one of ${Object.values(ApprovalDecision).join(", ")}`,
    );
  }

  return {
    decision: decision as ApprovalDecision,
    notes: optionalString(approval, "notes"),
  };
}

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  res.json(await productViewService.listProductViews(requireActor(req)));
});

export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  res.json(await productViewService.getProductDetailView(requireActor(req), req.params.id));
});

export const getProductDelay = asyncHandler(async (req: Request, res: Response) => {
  res.json(await productViewService.getDelayView(requireActor(req), req.params.id));
});

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const body = req.body as Record<string, unknown>;
  const product = await productService.createProduct({
    name: requireString(body, "name"),
    description: optionalString(body, "description"),
    ownerId: requireString(body, "ownerId"),
    spec: optionalString(body, "spec"),
    startDate: optionalDate(body, "startDate"),
    expectedCompletionDate: optionalDate(body, "expectedCompletionDate"),
  });
  res.status(201).json(await productViewService.getCreatedProductView(actor, product));
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;

  let status: ProductStatus | undefined;
  if (body.status !== undefined) {
    const raw = optionalString(body, "status");
    if (raw && !Object.values(ProductStatus).includes(raw as ProductStatus)) {
      throw new ValidationError(
        `status must be one of ${Object.values(ProductStatus).join(", ")}`,
      );
    }
    status = raw as ProductStatus | undefined;
  }

  const actor = requireActor(req);
  await productService.updateProduct(actor, req.params.id, {
    name: optionalString(body, "name"),
    description: body.description === null ? null : optionalString(body, "description"),
    ownerId: optionalString(body, "ownerId"),
    status,
    expectedCompletionDate: nullableDate(body, "expectedCompletionDate"),
    actualCompletionDate: nullableDate(body, "actualCompletionDate"),
  });
  res.json(await productViewService.getProductSummaryView(actor, req.params.id));
});

export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  await productService.deleteProduct(requireActor(req), req.params.id);
  res.status(204).send();
});

export const createProductVersion = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const actor = requireActor(req);
  const { version } = await productService.createProductVersion(actor, req.params.id, {
    spec: optionalString(body, "spec"),
    createdById: optionalString(body, "createdById"),
  });
  res.status(201).json({
    product: await productViewService.getProductSummaryView(actor, req.params.id),
    version,
  });
});

export const transitionProduct = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;

  let direction: "forward" | "backward" | undefined;
  if (body.direction !== undefined) {
    const raw = optionalString(body, "direction");
    if (raw !== "forward" && raw !== "backward") {
      throw new ValidationError('direction must be "forward" or "backward"');
    }
    direction = raw;
  }

  if (body.force !== undefined && typeof body.force !== "boolean") {
    throw new ValidationError("force must be a boolean");
  }

  const actor = requireActor(req);
  await stageTransitionService.transitionProduct(actor, req.params.id, {
    direction,
    reason: optionalString(body, "reason"),
    responsibleUserId: optionalString(body, "responsibleUserId"),
    approval: optionalApproval(body),
    force: body.force === true,
  });
  // Project for the viewer: an assignee who advanced their stage must not get
  // the whole product back.
  res.json(await productViewService.getProductDetailView(actor, req.params.id));
});
