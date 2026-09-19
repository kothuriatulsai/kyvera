import { Router } from "express";
import * as authController from "../controllers/authController";
import { authenticate } from "../middleware/authenticate";

export const authRoutes = Router();

// Public: you can't be logged in before you've registered or logged in.
authRoutes.post("/register", authController.register);
authRoutes.post("/login", authController.login);

authRoutes.get("/me", authenticate, authController.me);
