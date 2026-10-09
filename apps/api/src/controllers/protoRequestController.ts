import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as protoRequestService from "../services/protoRequestService";
import { asyncHandler } from "./asyncHandler";

export const listProtoRequests = asyncHandler(async (req: Request, res: Response) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  res.json(await protoRequestService.listProtoRequests(requireActor(req), projectId));
});

export const getProtoRequest = asyncHandler(async (req: Request, res: Response) => {
  res.json(await protoRequestService.getProtoRequest(requireActor(req), req.params.id));
});
