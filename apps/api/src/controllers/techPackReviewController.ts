import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as techPackReviewService from "../services/techPackReviewService";
import { asyncHandler } from "./asyncHandler";
import { requireString } from "./requestParsing";

function versionNumberFrom(req: Request): number {
  // Already validated as a positive integer by `versionNumberParam`.
  return Number(req.params.versionNumber);
}

export const listRemarks = asyncHandler(async (req: Request, res: Response) => {
  res.json(await techPackReviewService.listTechPackRemarks(req.params.id, versionNumberFrom(req)));
});

export const addRemark = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const body = req.body as Record<string, unknown>;
  const remark = await techPackReviewService.addTechPackRemark(
    actor.id,
    req.params.id,
    versionNumberFrom(req),
    { body: requireString(body, "body") },
  );
  res.status(201).json(remark);
});

export const confirmVersion = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const confirmation = await techPackReviewService.confirmTechPackVersion(
    actor.id,
    req.params.id,
    versionNumberFrom(req),
  );
  res.status(201).json(confirmation);
});
