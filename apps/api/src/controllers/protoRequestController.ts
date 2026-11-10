import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as protoRequestService from "../services/protoRequestService";
import { asyncHandler } from "./asyncHandler";
import { optionalString, requireDate, requireString } from "./requestParsing";
import { ValidationError } from "../services/errors";

export const listProtoRequests = asyncHandler(async (req: Request, res: Response) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  res.json(await protoRequestService.listProtoRequests(requireActor(req), projectId));
});

export const getProtoRequest = asyncHandler(async (req: Request, res: Response) => {
  res.json(await protoRequestService.getProtoRequest(requireActor(req), req.params.id));
});

// Steps 15-16 (ADR 0015).
export const assignManufacturer = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const body = req.body as Record<string, unknown>;
  const protoRequest = await protoRequestService.assignManufacturer(actor, req.params.id, {
    manufacturerId: requireString(body, "manufacturerId"),
    commercialNotes: optionalString(body, "commercialNotes"),
  });
  res.status(201).json(protoRequest);
});

// Step 17 (ADR 0015). Exactly one file, same multipart shape as the Tech
// Pack upload routes (`attachmentUpload`) but capped at one here, not ten.
export const uploadPo = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length !== 1) {
    throw new ValidationError("Exactly one file is required");
  }
  const [file] = files;
  const protoRequest = await protoRequestService.uploadPo(actor, req.params.id, {
    buffer: file.buffer,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
  });
  res.status(201).json(protoRequest);
});

// Step 19 (ADR 0015).
export const confirmProtoRequest = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const body = req.body as Record<string, unknown>;
  const protoRequest = await protoRequestService.confirmProtoRequest(actor, req.params.id, {
    agreedDeliveryDate: requireDate(body, "agreedDeliveryDate"),
    confirmationNote: optionalString(body, "confirmationNote"),
  });
  res.status(201).json(protoRequest);
});
