import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AttachmentStorage, SaveAttachmentInput, SavedAttachment } from "./AttachmentStorage";

/**
 * Dev implementation of `AttachmentStorage` (ADR 0008): writes under a root
 * directory on local disk. `storageKey` is a random filename, never derived
 * from the caller's original filename - `suggestedName` is used only to keep
 * the on-disk extension readable, and even that is sanitized, so a malicious
 * original name can't attempt path traversal.
 */
export class LocalDiskStorage implements AttachmentStorage {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  async save(input: SaveAttachmentInput): Promise<SavedAttachment> {
    const ext = extensionOf(input.suggestedName);
    const storageKey = ext ? `${randomUUID()}.${ext}` : randomUUID();
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.resolvePath(storageKey), input.buffer);
    return { storageKey };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolvePath(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.resolvePath(storageKey), { force: true });
  }

  // Defence in depth: storageKey is always our own randomUUID()-based value
  // (generated in `save`), which can't escape rootDir on its own. This guards
  // the case anyway, so a future caller passing back a stored key can never
  // resolve outside the storage root, however that key got to them.
  private resolvePath(storageKey: string): string {
    const resolved = path.resolve(this.rootDir, storageKey);
    if (resolved !== this.rootDir && !resolved.startsWith(this.rootDir + path.sep)) {
      throw new Error(`Refusing to resolve a storage key outside the storage root: ${storageKey}`);
    }
    return resolved;
  }
}

function extensionOf(name: string): string | undefined {
  const ext = name.split(".").pop();
  if (!ext || ext === name) return undefined;
  // Keep only characters that are safe in a filename - the extension is the
  // one piece of the original name this implementation reuses.
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned || undefined;
}
