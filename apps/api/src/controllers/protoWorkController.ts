import type { Request, Response } from "express";
import type { ProtoWorkStatus } from "@prisma/client";
import { requireActor } from "../middleware/authenticate";
import * as protoWorkService from "../services/protoWorkService";
import { asyncHandler } from "./asyncHandler";
import { optionalString, requireDate, requireString } from "./requestParsing";
import { ValidationError } from "../services/errors";

const VALID_STATUSES: ProtoWorkStatus[] = ["QUEUED", "ASSIGNED", "COMPLETED"];

function statusFromQuery(req: Request): ProtoWorkStatus | undefined {
  const value = req.query.status;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !VALID_STATUSES.includes(value as ProtoWorkStatus)) {
    throw new ValidationError(`status must be one of ${VALID_STATUSES.join(", ")}`);
  }
  return value as ProtoWorkStatus;
}

export const listProtoWork = asyncHandler(async (req: Request, res: Response) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  res.json(await protoWorkService.listProtoWork(requireActor(req), projectId, statusFromQuery(req)));
});

export const getProtoWork = asyncHandler(async (req: Request, res: Response) => {
  res.json(await protoWorkService.getProtoWork(requireActor(req), req.params.id));
});

// Step 20.
export const assignMerchandiser = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const body = req.body as Record<string, unknown>;
  const protoWork = await protoWorkService.assignMerchandiser(
    actor,
    req.params.id,
    requireString(body, "merchandiserId"),
  );
  res.status(201).json(protoWork);
});

// Step 22.
export const addDeliveryConfirmation = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const body = req.body as Record<string, unknown>;
  const protoWork = await protoWorkService.addDeliveryConfirmation(actor, req.params.id, {
    deliveryDate: requireDate(body, "deliveryDate"),
    notes: optionalString(body, "notes"),
  });
  res.status(201).json(protoWork);
});

// Step 21.
export const addUpdate = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const body = req.body as Record<string, unknown>;
  const protoWork = await protoWorkService.addUpdate(actor, req.params.id, {
    body: requireString(body, "body"),
  });
  res.status(201).json(protoWork);
});

// Step 23.
export const completeProtoWork = asyncHandler(async (req: Request, res: Response) => {
  const protoWork = await protoWorkService.completeProtoWork(requireActor(req), req.params.id);
  res.status(201).json(protoWork);
});
