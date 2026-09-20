import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as assignmentService from "../services/assignmentService";
import { asyncHandler } from "./asyncHandler";
import { requireString } from "./requestParsing";

export const assignUser = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const assignment = await assignmentService.assignUser(requireActor(req), req.params.id, {
    stageId: requireString(body, "stageId"),
    userId: requireString(body, "userId"),
  });
  res.status(201).json(assignment);
});

export const unassignUser = asyncHandler(async (req: Request, res: Response) => {
  await assignmentService.unassignUser(requireActor(req), req.params.id, req.params.assignmentId);
  res.status(204).send();
});

export const markReady = asyncHandler(async (req: Request, res: Response) => {
  const result = await assignmentService.markAssignmentReady(
    requireActor(req),
    req.params.id,
    req.params.assignmentId,
  );
  res.json(result);
});

export const addProgressNote = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const note = await assignmentService.addProgressNote(
    requireActor(req),
    req.params.id,
    req.params.stageId,
    requireString(body, "note"),
  );
  res.status(201).json(note);
});
