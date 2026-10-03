import { getUploadsDir } from "../../config";
import { LocalDiskStorage } from "./LocalDiskStorage";
import type { AttachmentStorage } from "./AttachmentStorage";

export type { AttachmentStorage, SaveAttachmentInput, SavedAttachment } from "./AttachmentStorage";
export {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_SIZE_BYTES,
  isAllowedAttachmentExtension,
} from "./AttachmentStorage";
export { LocalDiskStorage } from "./LocalDiskStorage";

// The one implementation in use today (ADR 0008). Swapping to object storage
// later means changing this line, not any caller: everything above depends
// only on the `AttachmentStorage` interface.
export const attachmentStorage: AttachmentStorage = new LocalDiskStorage(getUploadsDir());
