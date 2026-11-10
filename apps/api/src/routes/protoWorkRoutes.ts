import { Router } from "express";
import * as protoWorkController from "../controllers/protoWorkController";
import { requireRole } from "../middleware/requireRole";
import { uuidParam } from "../middleware/uuidParam";

// SOP domain, Stage 5 (ADR 0006 point 8, ADR 0015). Reads: layer A only, no
// stage-level restriction of its own - same precedent ADR 0013 already set
// for ProtoRequest. Writes: role-gated, ADMIN carve-in throughout (none of
// these are the Engineering-confirm/Management-decide style adjudication
// ADR 0009 carved ADMIN out of).
export const protoWorkRoutes = Router();

protoWorkRoutes.param("id", uuidParam);

protoWorkRoutes.get("/", protoWorkController.listProtoWork);
protoWorkRoutes.get("/:id", protoWorkController.getProtoWork);

// Step 20: PMO assigns from the Work Queue.
protoWorkRoutes.post(
  "/:id/assign",
  requireRole("PMO", "ADMIN"),
  protoWorkController.assignMerchandiser,
);

// Step 22: the periodic delivery-date reconfirmation the SOP asks the
// system to prompt for.
protoWorkRoutes.post(
  "/:id/delivery-confirmations",
  requireRole("MERCHANDISER", "ADMIN"),
  protoWorkController.addDeliveryConfirmation,
);

// Step 21: the "remarks/chat updates" thread, open to every Stage 5 process
// owner (PMO/Merchandiser/Engineering, per the SOP's role table) plus ADMIN.
protoWorkRoutes.post(
  "/:id/updates",
  requireRole("PMO", "ENGINEERING", "MERCHANDISER", "ADMIN"),
  protoWorkController.addUpdate,
);

// Step 23.
protoWorkRoutes.post(
  "/:id/complete",
  requireRole("MERCHANDISER", "ADMIN"),
  protoWorkController.completeProtoWork,
);
