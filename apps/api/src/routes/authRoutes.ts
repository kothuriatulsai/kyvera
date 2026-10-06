import { Router } from "express";
import * as authController from "../controllers/authController";
import { authenticate } from "../middleware/authenticate";

export const authRoutes = Router();

// Public: accounts come from the seed for now (ADR 0010) - there is no
// self-registration endpoint.
authRoutes.post("/login", authController.login);

authRoutes.get("/me", authenticate, authController.me);
