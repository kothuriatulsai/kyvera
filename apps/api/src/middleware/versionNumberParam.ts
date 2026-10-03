import type { NextFunction, Request, Response } from "express";
import { NotFoundError } from "../services/errors";

const VERSION_NUMBER_PATTERN = /^[1-9][0-9]*$/;

/**
 * For `router.param(...)`: a path segment that isn't a positive integer can't
 * match any TechPackVersion's `versionNumber`, so it's a 404 like any other
 * missing resource - same reasoning as `uuidParam`.
 */
export function versionNumberParam(req: Request, _res: Response, next: NextFunction, value: string) {
  if (VERSION_NUMBER_PATTERN.test(value)) {
    next();
  } else {
    next(new NotFoundError("Not found"));
  }
}
