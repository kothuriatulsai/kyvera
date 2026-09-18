import { Router } from "express";
import * as stageController from "../controllers/stageController";

export const stageRoutes = Router();

stageRoutes.get("/", stageController.listStages);
