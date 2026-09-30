import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { requireActor } from "./authenticate";
import { ForbiddenError } from "../services/errors";

/**
 * SOP-domain authorization (ADR 0007, ADR 0009): a plain role check against
 * the actor's *current* role (loaded fresh by `authenticate` on every
 * request), not the assignment/visibility model ADR 0004 built for the old
 * module - the SOP doesn't state a confidentiality need for who can see a
 * Project or Tech Pack, only who may act on one.
 *
 * There is no built-in ADMIN carve-out: a caller that wants ADMIN to bypass a
 * gate lists it explicitly in `roles`. Most gates do; the Engineering-confirm
 * and Management-approve gates deliberately don't (ADR 0009).
 *
 * Must be mounted after `authenticate`.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const actor = requireActor(req);
    if (!roles.includes(actor.role)) {
      next(new ForbiddenError(`This action requires one of these roles: ${roles.join(", ")}`));
      return;
    }
    next();
  };
}
