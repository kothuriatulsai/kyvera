export interface SaveAttachmentInput {
  buffer: Buffer;
  /** Used only to keep the on-disk extension readable - never trusted as a path. */
  suggestedName: string;
}

export interface SavedAttachment {
  storageKey: string;
}

/**
 * Where attachment bytes live (ADR 0008). `Attachment` rows store metadata
 * only; everything about where/how the bytes themselves are kept sits behind
 * this interface so an implementation can be swapped later (object storage in
 * a real deployment) without anything above this layer changing.
 */
export interface AttachmentStorage {
  save(input: SaveAttachmentInput): Promise<SavedAttachment>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

// Upload policy (ADR 0008 follow-up). Enforced by the upload endpoint before
// calling `save()`, not inside a storage implementation itself - a future
// object-storage implementation shouldn't have to duplicate this policy, and
// a storage implementation has no business deciding what's an allowed file.
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "dwg",
  "dxf",
  "step",
  "stp",
  "png",
  "jpg",
  "jpeg",
] as const;

export function isAllowedAttachmentExtension(originalName: string): boolean {
  const ext = originalName.split(".").pop()?.toLowerCase();
  return ext !== undefined && (ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext);
}
