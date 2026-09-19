import type { Request, Response } from "express";
import { ApprovalDecision, ProductStatus } from "@prisma/client";
import * as productService from "../services/productService";
import * as stageTransitionService from "../services/stageTransitionService";
import type { ApprovalInput } from "../services/stageTransitionService";
import * as productDelayService from "../services/productDelayService";
import { ValidationError } from "../services/errors";
import { asyncHandler } from "./asyncHandler";

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${field} is required and must be a non-empty string`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }
  return value;
}

function optionalDate(body: Record<string, unknown>, field: string): Date | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be an ISO date string`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${field} must be a valid ISO date string`);
  }
  return parsed;
}

function nullableDate(body: Record<string, unknown>, field: string): Date | null | undefined {
  if (body[field] === null) return null;
  return optionalDate(body, field);
}

function optionalApproval(body: Record<string, unknown>): ApprovalInput | undefined {
  const raw = body.approval;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("approval must be an object");
  }
  const approval = raw as Record<string, unknown>;

  const decision = requireString(approval, "decision");
  if (!Object.values(ApprovalDecision).includes(decision as ApprovalDecision)) {
    throw new ValidationError(
      `decision must be one of ${Object.values(ApprovalDecision).join(", ")}`,
    );
  }

  return {
    decision: decision as ApprovalDecision,
    decidedById: requireString(approval, "decidedById"),
    notes: optionalString(approval, "notes"),
  };
}

export const listProducts = asyncHandler(async (_req: Request, res: Response) => {
  const products = await productService.listProducts();
  res.json(products);
});

export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.getProductById(req.params.id);
  res.json(product);
});

export const getProductDelay = asyncHandler(async (req: Request, res: Response) => {
  const delay = await productDelayService.computeDelayForProduct(req.params.id);
  res.json(delay);
});

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const product = await productService.createProduct({
    name: requireString(body, "name"),
    description: optionalString(body, "description"),
    ownerId: requireString(body, "ownerId"),
    spec: optionalString(body, "spec"),
    startDate: optionalDate(body, "startDate"),
    expectedCompletionDate: optionalDate(body, "expectedCompletionDate"),
  });
  res.status(201).json(product);
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

  const product = await productService.updateProduct(req.params.id, {
    name: optionalString(body, "name"),
    description: body.description === null ? null : optionalString(body, "description"),
    ownerId: optionalString(body, "ownerId"),
    status,
    expectedCompletionDate: nullableDate(body, "expectedCompletionDate"),
    actualCompletionDate: nullableDate(body, "actualCompletionDate"),
  });
  res.json(product);
});

export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  await productService.deleteProduct(req.params.id);
  res.status(204).send();
});

export const createProductVersion = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const result = await productService.createProductVersion(req.params.id, {
    spec: optionalString(body, "spec"),
    createdById: optionalString(body, "createdById"),
  });
  res.status(201).json(result);
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

  const product = await stageTransitionService.transitionProduct(req.params.id, {
    direction,
    reason: optionalString(body, "reason"),
    responsibleUserId: optionalString(body, "responsibleUserId"),
    approval: optionalApproval(body),
  });
  res.json(product);
});
