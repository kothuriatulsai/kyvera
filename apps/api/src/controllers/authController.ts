import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as authService from "../services/authService";
import { asyncHandler } from "./asyncHandler";
import { requireString } from "./requestParsing";

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
