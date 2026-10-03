import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { isAllowedAttachmentExtension, MAX_ATTACHMENT_SIZE_BYTES } from "../services/storage";
import { ValidationError } from "../services/errors";

// A generous cap on files per request, independent of per-file size - a Tech
// Pack version realistically has a handful of attachments (the document
// itself plus a few design references), never hundreds.
const MAX_FILES_PER_UPLOAD = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE_BYTES, files: MAX_FILES_PER_UPLOAD },
  fileFilter(_req, file, callback) {
    if (!isAllowedAttachmentExtension(file.originalname)) {
      callback(new ValidationError(`${file.originalname} has a file type that is not allowed`));
      return;
    }
    callback(null, true);
  },
});

const uploadFiles = upload.array("files", MAX_FILES_PER_UPLOAD);

/**
 * Parses a `multipart/form-data` request's `files` field into
 * `req.files` (buffered in memory - `AttachmentStorage` takes a `Buffer`,
 * see ADR 0008) and its other fields into `req.body`, same as `express.json()`
 * does for a JSON body. A rejected extension, an oversized file, or too many
 * files all become a `ValidationError` (400) here rather than reaching the
 * generic 500 handler as a raw Multer error.
 */
export function attachmentUpload(req: Request, _res: Response, next: NextFunction) {
  uploadFiles(req, _res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      next(new ValidationError(err.message));
      return;
    }
    next(err);
  });
}
