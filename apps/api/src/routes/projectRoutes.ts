import { Router } from "express";
import * as projectController from "../controllers/projectController";
import { requireRole } from "../middleware/requireRole";
import { uuidParam } from "../middleware/uuidParam";

// SOP domain, Stage 1 (ADR 0006/0007). Mounted alongside, not inside, the old
// module's routers - see routes/index.ts.
export const projectRoutes = Router();

projectRoutes.param("id", uuidParam);

// Reads: any authenticated user, for now (finalized SOP authorization
// mapping - narrower than "everyone", since everything here already sits
// behind `authenticate`). Revisit if a real need for narrower read access
// shows up.
projectRoutes.get("/", projectController.listProjects);
projectRoutes.get("/:id", projectController.getProject);

// Create: PMO owns Stage 1. ADMIN may also create - ADR 0009 only excludes
// ADMIN from the Engineering-confirm / Management-approve gates, not this one.
projectRoutes.post("/", requireRole("PMO", "ADMIN"), projectController.createProject);
