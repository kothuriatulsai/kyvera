import type { NextFunction, Request, Response } from "express";
import { NotFoundError } from "../services/errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * For `router.param(...)`: a path id that isn't a UUID can't match anything, so
 * it's a 404 like any other missing resource. Without it Postgres rejects the
 * malformed value and the request would surface as a 500.
 */
export function uuidParam(_req: Request, _res: Response, next: NextFunction, value: string) {
  if (UUID_PATTERN.test(value)) {
    next();
  } else {
    next(new NotFoundError("Not found"));
  }
}
