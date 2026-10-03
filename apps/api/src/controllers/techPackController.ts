import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as techPackService from "../services/techPackService";
import type { UploadedFile } from "../services/techPackService";
import { asyncHandler } from "./asyncHandler";
import { optionalString, requireString } from "./requestParsing";

function filesFromRequest(req: Request): UploadedFile[] {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  return files.map((file) => ({
    buffer: file.buffer,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
  }));
}

export const listTechPacks = asyncHandler(async (req: Request, res: Response) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  res.json(await techPackService.listTechPacks(projectId));
});

export const getTechPack = asyncHandler(async (req: Request, res: Response) => {
  res.json(await techPackService.getTechPack(req.params.id));
});

export const createTechPack = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const body = req.body as Record<string, unknown>;
  const techPack = await techPackService.createTechPack(actor.id, {
    projectId: requireString(body, "projectId"),
    notes: optionalString(body, "notes"),
    files: filesFromRequest(req),
  });
  res.status(201).json(techPack);
});

export const uploadTechPackVersion = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const body = req.body as Record<string, unknown>;
  const techPack = await techPackService.uploadTechPackVersion(actor.id, req.params.id, {
    notes: optionalString(body, "notes"),
    files: filesFromRequest(req),
  });
  res.status(201).json(techPack);
});
