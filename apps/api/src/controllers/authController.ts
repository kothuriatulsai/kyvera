import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as authService from "../services/authService";
import { ValidationError } from "../services/errors";
import { asyncHandler } from "./asyncHandler";
import { requireString } from "./requestParsing";

export const register = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;

  // Reject rather than silently ignore: a client sending a role expects it to
  // matter. Public registration always creates the least-privileged role.
  if (body.role !== undefined) {
    throw new ValidationError("role cannot be set at registration");
  }

  const user = await authService.register({
    name: requireString(body, "name"),
    email: requireString(body, "email"),
    password: requireString(body, "password"),
  });
  res.status(201).json(user);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const result = await authService.login({
    email: requireString(body, "email"),
    password: requireString(body, "password"),
  });
  res.json(result);
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getCurrentUser(requireActor(req));
  res.json(user);
});
