import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as projectService from "../services/projectService";
import { asyncHandler } from "./asyncHandler";
import { optionalString, requireString } from "./requestParsing";

export const listProjects = asyncHandler(async (req: Request, res: Response) => {
  res.json(await projectService.listProjects(requireActor(req)));
});

export const getProject = asyncHandler(async (req: Request, res: Response) => {
  res.json(await projectService.getProject(requireActor(req), req.params.id));
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

export const listMembers = asyncHandler(async (req: Request, res: Response) => {
  res.json(await projectService.listMembers(requireActor(req), req.params.id));
});

export const listMembershipCandidates = asyncHandler(async (req: Request, res: Response) => {
  res.json(await projectService.listMembershipCandidates(requireActor(req), req.params.id));
});

export const addMember = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const member = await projectService.addMember(requireActor(req), req.params.id, requireString(body, "userId"));
  res.status(201).json(member);
});

export const removeMember = asyncHandler(async (req: Request, res: Response) => {
  await projectService.removeMember(requireActor(req), req.params.id, req.params.userId);
  res.status(204).send();
});
