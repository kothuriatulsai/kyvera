import type { Actor } from "../services/tokenService";

declare module "express-serve-static-core" {
  interface Request {
    /** Set by the `authenticate` middleware once a token has been verified. */
    actor?: Actor;
  }
}
