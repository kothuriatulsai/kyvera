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

// Upload policy (ADR 0008 follow-up) now lives in @kyvera/shared-types, so the
// web upload form can enforce the exact same rule client-side - re-exported
// here so every existing caller in this package keeps importing from this
// module (or from ./index, which re-exports this) unchanged.
export {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_SIZE_BYTES,
  isAllowedAttachmentExtension,
} from "@kyvera/shared-types";
