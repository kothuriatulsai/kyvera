import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as attachmentService from "../services/attachmentService";
import { asyncHandler } from "./asyncHandler";
import { attachmentContentDisposition } from "./contentDisposition";

export const downloadAttachment = asyncHandler(async (req: Request, res: Response) => {
  const { attachment, buffer } = await attachmentService.downloadAttachment(requireActor(req), req.params.id);
  res.set("Content-Type", attachment.mimeType);
  res.set("Content-Disposition", attachmentContentDisposition(attachment.originalName));
  res.send(buffer);
});
