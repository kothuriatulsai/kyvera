import { Router } from "express";
import * as projectController from "../controllers/projectController";
import { requireRole } from "../middleware/requireRole";
import { uuidParam } from "../middleware/uuidParam";

// SOP domain, Stage 1 (ADR 0006/0007/0013). Mounted alongside, not inside,
// the old module's routers - see routes/index.ts.
export const projectRoutes = Router();

projectRoutes.param("id", uuidParam);
projectRoutes.param("userId", uuidParam);

// Reads: visibility-filtered per actor (ADR 0013, superseding the earlier
// "any authenticated user" note this comment used to make) - see
// services/visibility.ts. listProjects filters; getProject 404s a Project
// the actor can't see.
projectRoutes.get("/", projectController.listProjects);
projectRoutes.get("/:id", projectController.getProject);

// Create: PMO owns Stage 1. ADMIN may also create - ADR 0009 only excludes
// ADMIN from the Engineering-confirm / Management-approve gates, not this one.
projectRoutes.post("/", requireRole("PMO", "ADMIN"), projectController.createProject);

// Membership (ADR 0013, layer A). Read: open to anyone who can see the
// Project (same 404-if-invisible rule as the Project itself). Write:
// PMO/ADMIN only - the two roles the plan names as managing membership.
projectRoutes.get("/:id/members", projectController.listMembers);
// The add-member picker's candidate list - PMO/ADMIN only, same as the
// write below, since it exists only to serve that action.
projectRoutes.get(
  "/:id/members/candidates",
  requireRole("PMO", "ADMIN"),
  projectController.listMembershipCandidates,
);
projectRoutes.post("/:id/members", requireRole("PMO", "ADMIN"), projectController.addMember);
projectRoutes.post(
  "/:id/members/:userId/remove",
  requireRole("PMO", "ADMIN"),
  projectController.removeMember,
);
