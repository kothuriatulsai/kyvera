import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as stageService from "../services/stageService";
import { asyncHandler } from "./asyncHandler";

export const listStages = asyncHandler(async (req: Request, res: Response) => {
  res.json(await stageService.listStages(requireActor(req)));
});
