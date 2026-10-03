import { Router } from "express";
import * as techPackController from "../controllers/techPackController";
import { attachmentUpload } from "../middleware/attachmentUpload";
import { requireRole } from "../middleware/requireRole";
import { uuidParam } from "../middleware/uuidParam";

// SOP domain, Stage 2 (ADR 0006/0007). Mounted alongside, not inside, the old
// module's routers - see routes/index.ts.
export const techPackRoutes = Router();

techPackRoutes.param("id", uuidParam);

// Reads: any authenticated user, for now - same reasoning as projectRoutes.
techPackRoutes.get("/", techPackController.listTechPacks);
techPackRoutes.get("/:id", techPackController.getTechPack);

// Product Designer owns Tech Packs/versions/attachments (ADMIN too) - ADR 0009
// only narrows the Engineering-confirm/Management-approve gates, not this one.
techPackRoutes.post(
  "/",
  requireRole("PRODUCT_DESIGNER", "ADMIN"),
  attachmentUpload,
  techPackController.createTechPack,
);
techPackRoutes.post(
  "/:id/versions",
  requireRole("PRODUCT_DESIGNER", "ADMIN"),
  attachmentUpload,
  techPackController.uploadTechPackVersion,
);
