import { Router } from "express";
import * as authController from "../controllers/authController";
import { authenticate } from "../middleware/authenticate";

export const authRoutes = Router();

// Public: accounts come from the seed for now (ADR 0010) - there is no
// self-registration endpoint.
authRoutes.post("/login", authController.login);

// Cookie-authenticated, not Bearer-token-authenticated (ADR 0012) - neither
// goes through `authenticate`, and both check the request's Origin
// themselves as a CSRF guard.
authRoutes.post("/refresh", authController.refresh);
authRoutes.post("/logout", authController.logout);

authRoutes.get("/me", authenticate, authController.me);
// Exempt from `requirePasswordChanged` (ADR 0011) by never passing through
// it: authenticated directly, right here, same as /me above.
authRoutes.post("/change-password", authenticate, authController.changePassword);
