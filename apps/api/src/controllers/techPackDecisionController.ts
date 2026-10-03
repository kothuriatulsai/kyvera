import type { Request, Response } from "express";
import { ApprovalDecision } from "@prisma/client";
import { requireActor } from "../middleware/authenticate";
import * as techPackDecisionService from "../services/techPackDecisionService";
import { ValidationError } from "../services/errors";
import { asyncHandler } from "./asyncHandler";
import { optionalString, requireString } from "./requestParsing";

function versionNumberFrom(req: Request): number {
  // Already validated as a positive integer by `versionNumberParam`.
  return Number(req.params.versionNumber);
}

export const decideTechPackVersion = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const body = req.body as Record<string, unknown>;

  const decision = requireString(body, "decision");
  if (!Object.values(ApprovalDecision).includes(decision as ApprovalDecision)) {
    throw new ValidationError(`decision must be one of ${Object.values(ApprovalDecision).join(", ")}`);
  }

  const result = await techPackDecisionService.decideTechPackVersion(
    actor.id,
    req.params.id,
    versionNumberFrom(req),
    { decision: decision as ApprovalDecision, notes: optionalString(body, "notes") },
  );
  res.status(201).json(result);
});
