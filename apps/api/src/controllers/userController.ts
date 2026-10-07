import type { Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { requireActor } from "../middleware/authenticate";
import * as userManagementService from "../services/userManagementService";
import { ValidationError } from "../services/errors";
import { asyncHandler } from "./asyncHandler";
import { requireString } from "./requestParsing";

function roleFrom(body: Record<string, unknown>): UserRole {
  const role = requireString(body, "role");
  if (!Object.values(UserRole).includes(role as UserRole)) {
    throw new ValidationError(`role must be one of ${Object.values(UserRole).join(", ")}`);
  }
  return role as UserRole;
}

export const listUsers = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await userManagementService.listUsers());
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const { user, temporaryPassword } = await userManagementService.createUser({
    name: requireString(body, "name"),
    email: requireString(body, "email"),
    role: roleFrom(body),
  });
  res.status(201).json({ user, temporaryPassword });
});

export const changeRole = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const user = await userManagementService.changeRole(req.params.id, roleFrom(body));
  res.json(user);
});

export const deactivateUser = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const user = await userManagementService.deactivateUser(actor.id, req.params.id);
  res.json(user);
});

export const reactivateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await userManagementService.reactivateUser(req.params.id);
  res.json(user);
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { user, temporaryPassword } = await userManagementService.resetPassword(req.params.id);
  res.json({ user, temporaryPassword });
});
