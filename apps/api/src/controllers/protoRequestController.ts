import type { Request, Response } from "express";
import * as protoRequestService from "../services/protoRequestService";
import { asyncHandler } from "./asyncHandler";

export const listProtoRequests = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await protoRequestService.listProtoRequests());
});

export const getProtoRequest = asyncHandler(async (req: Request, res: Response) => {
  res.json(await protoRequestService.getProtoRequest(req.params.id));
});
