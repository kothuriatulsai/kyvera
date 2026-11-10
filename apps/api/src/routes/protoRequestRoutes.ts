import { Router } from "express";
import * as protoRequestController from "../controllers/protoRequestController";
import { attachmentUpload } from "../middleware/attachmentUpload";
import { requireRole } from "../middleware/requireRole";
import { uuidParam } from "../middleware/uuidParam";

// SOP domain, Stage 3's output / Stage 4's subject (ADR 0006 point 8). The
// ProtoRequest itself is created only as a side effect of approving a
// TechPack version (techPackDecisionService.decideTechPackVersion) - no
// direct create endpoint. Stage 4's actions (ADR 0015) extend it below.
export const protoRequestRoutes = Router();

protoRequestRoutes.param("id", uuidParam);

protoRequestRoutes.get("/", protoRequestController.listProtoRequests);
protoRequestRoutes.get("/:id", protoRequestController.getProtoRequest);

// Steps 15-16: PMO assigns (or reassigns, pre-confirmation) the
// manufacturer. ADMIN carve-in, not the Engineering-confirm/Management-decide
// carve-out (ADR 0009) - this is a single-party operational action, not an
// adjudication between two independent parties.
protoRequestRoutes.post(
  "/:id/manufacturer",
  requireRole("PMO", "ADMIN"),
  protoRequestController.assignManufacturer,
);

// Step 17: Finance uploads the PO.
protoRequestRoutes.post(
  "/:id/po",
  requireRole("FINANCE", "ADMIN"),
  attachmentUpload,
  protoRequestController.uploadPo,
);

// Step 19: PMO confirms - requires a manufacturer and PO already set,
// creates a ProtoWork and releases it to the Work Queue.
protoRequestRoutes.post(
  "/:id/confirm",
  requireRole("PMO", "ADMIN"),
  protoRequestController.confirmProtoRequest,
);
