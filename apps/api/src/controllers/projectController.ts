import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as projectService from "../services/projectService";
import { asyncHandler } from "./asyncHandler";
import { optionalString, requireString } from "./requestParsing";

export const listProjects = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await projectService.listProjects());
});

export const getProject = asyncHandler(async (req: Request, res: Response) => {
  res.json(await projectService.getProject(req.params.id));
});

export const createProject = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const body = req.body as Record<string, unknown>;
  const project = await projectService.createProject(actor.id, {
    name: requireString(body, "name"),
    productName: requireString(body, "productName"),
    productCategory: optionalString(body, "productCategory"),
  });
  res.status(201).json(project);
});
