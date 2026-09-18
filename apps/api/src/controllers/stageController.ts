import type { Request, Response } from "express";
import * as stageService from "../services/stageService";
import { asyncHandler } from "./asyncHandler";

export const listStages = asyncHandler(async (_req: Request, res: Response) => {
  const stages = await stageService.listStages();
  res.json(stages);
});
