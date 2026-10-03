import { Router } from "express";
import * as attachmentController from "../controllers/attachmentController";
import { uuidParam } from "../middleware/uuidParam";

// SOP domain (ADR 0006/0007/0008). Not nested under techPackRoutes - an
// Attachment gains more nullable owner FKs as later slices need them (ADR
// 0008), so one flat download endpoint, keyed only on the attachment's own
// id, outlives any one owner.
export const attachmentRoutes = Router();

attachmentRoutes.param("id", uuidParam);

// Reads: any authenticated user, for now - same reasoning as projectRoutes.
// Never a static file server: this is the one path that can read the bytes.
attachmentRoutes.get("/:id/download", attachmentController.downloadAttachment);
