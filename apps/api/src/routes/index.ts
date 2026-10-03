import { Router } from "express";
import { authenticate } from "../middleware/authenticate";
import { attachmentRoutes } from "./attachmentRoutes";
import { authRoutes } from "./authRoutes";
import { productRoutes } from "./productRoutes";
import { projectRoutes } from "./projectRoutes";
import { stageRoutes } from "./stageRoutes";
import { techPackRoutes } from "./techPackRoutes";

export const routes = Router();

// Public: registration and login (and /health, mounted in app.ts).
routes.use("/auth", authRoutes);

// Everything below requires a valid token — "logged in" only. Which actor may
// do or see what is enforced further down: the service layer for the old
// module (ADR 0004), a plain role gate for the SOP domain (ADR 0007/0009).
routes.use(authenticate);
routes.use("/products", productRoutes);
routes.use("/stages", stageRoutes);

// SOP domain (ADR 0006/0007) - coexists with, does not replace, the above.
routes.use("/projects", projectRoutes);
routes.use("/tech-packs", techPackRoutes);
routes.use("/attachments", attachmentRoutes);
