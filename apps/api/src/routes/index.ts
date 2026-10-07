import { Router } from "express";
import { authenticate } from "../middleware/authenticate";
import { requirePasswordChanged } from "../middleware/requirePasswordChanged";
import { attachmentRoutes } from "./attachmentRoutes";
import { authRoutes } from "./authRoutes";
import { projectRoutes } from "./projectRoutes";
import { protoRequestRoutes } from "./protoRequestRoutes";
import { techPackRoutes } from "./techPackRoutes";
import { userRoutes } from "./userRoutes";

export const routes = Router();

// Public: login only (and /health, mounted in app.ts). GET /auth/me and
// POST /auth/change-password live here too, each authenticating directly -
// see authRoutes.ts - so a user with mustChangePassword set can still reach
// them once `requirePasswordChanged` below blocks everything else (ADR 0011).
routes.use("/auth", authRoutes);

// Everything below requires a valid token — "logged in" only. Which actor may
// do or see what is enforced further down: a plain role gate (ADR 0007/0009).
routes.use(authenticate);
routes.use(requirePasswordChanged);
routes.use("/projects", projectRoutes);
routes.use("/tech-packs", techPackRoutes);
routes.use("/attachments", attachmentRoutes);
routes.use("/proto-requests", protoRequestRoutes);
routes.use("/users", userRoutes);
