import { Router } from "express";
import { authenticate } from "../middleware/authenticate";
import { authRoutes } from "./authRoutes";
import { productRoutes } from "./productRoutes";
import { stageRoutes } from "./stageRoutes";

export const routes = Router();

// Public: registration and login (and /health, mounted in app.ts).
routes.use("/auth", authRoutes);

// Everything below requires a valid token — "logged in" only. Which actor may
// do or see what is enforced in the service layer (ADR 0004), not here.
routes.use(authenticate);
routes.use("/products", productRoutes);
routes.use("/stages", stageRoutes);
