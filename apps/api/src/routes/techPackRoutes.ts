import { Router } from "express";
import * as techPackController from "../controllers/techPackController";
import * as techPackDecisionController from "../controllers/techPackDecisionController";
import * as techPackReviewController from "../controllers/techPackReviewController";
import { attachmentUpload } from "../middleware/attachmentUpload";
import { requireRole } from "../middleware/requireRole";
import { uuidParam } from "../middleware/uuidParam";
import { versionNumberParam } from "../middleware/versionNumberParam";

// SOP domain, Stage 2 (ADR 0006/0007). Mounted alongside, not inside, the old
// module's routers - see routes/index.ts.
export const techPackRoutes = Router();

techPackRoutes.param("id", uuidParam);
techPackRoutes.param("versionNumber", versionNumberParam);

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

// Stage 3, Engineering half (ADR 0006 point 4/5). Remarks: Engineering's
// review-loop with the Product Designer, open to both (ADMIN too, same
// reasoning as above). Confirmation: Engineering-only, no ADMIN carve-out -
// ADR 0009.
techPackRoutes.get("/:id/versions/:versionNumber/remarks", techPackReviewController.listRemarks);
techPackRoutes.post(
  "/:id/versions/:versionNumber/remarks",
  requireRole("ENGINEERING", "PRODUCT_DESIGNER", "ADMIN"),
  techPackReviewController.addRemark,
);
techPackRoutes.post(
  "/:id/versions/:versionNumber/confirm",
  requireRole("ENGINEERING"),
  techPackReviewController.confirmVersion,
);

// Stage 3, Management half (ADR 0006 point 4). Management-only, no ADMIN
// carve-out - ADR 0009.
techPackRoutes.post(
  "/:id/versions/:versionNumber/decision",
  requireRole("MANAGEMENT"),
  techPackDecisionController.decideTechPackVersion,
);
