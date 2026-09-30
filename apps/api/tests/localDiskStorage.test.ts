import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  isAllowedAttachmentExtension,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "../src/services/storage/AttachmentStorage";
import { LocalDiskStorage } from "../src/services/storage/LocalDiskStorage";

describe("LocalDiskStorage", () => {
  let root: string;
  let storage: LocalDiskStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "kyvera-attachments-"));
    storage = new LocalDiskStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips a saved file through read()", async () => {
    const buffer = Buffer.from("tech pack contents");
    const { storageKey } = await storage.save({ buffer, suggestedName: "spec.pdf" });

    expect(await storage.read(storageKey)).toEqual(buffer);
  });

  it("does not derive storageKey from the original filename", async () => {
    const { storageKey } = await storage.save({
      buffer: Buffer.from("x"),
      suggestedName: "very secret product name.pdf",
    });

    expect(storageKey).not.toContain("secret");
    expect(storageKey).not.toContain("very");
    // The extension is the one piece of the original name it keeps.
    expect(storageKey.endsWith(".pdf")).toBe(true);
  });

  it("sanitizes an unsafe extension instead of embedding it verbatim", async () => {
    const { storageKey } = await storage.save({
      buffer: Buffer.from("x"),
      suggestedName: "payload.../../etc",
    });

    // "etc" survives as a (harmless) extension-shaped suffix; no path
    // separators or ".." make it into the generated key.
    expect(storageKey).not.toMatch(/[/\\]/);
    expect(storageKey).not.toContain("..");
  });

  it("creates the root directory on first save if it doesn't exist yet", async () => {
    const freshRoot = path.join(root, "nested", "dir");
    const fresh = new LocalDiskStorage(freshRoot);

    await fresh.save({ buffer: Buffer.from("x"), suggestedName: "a.png" });

    expect(await readdir(freshRoot)).toHaveLength(1);
  });

  it("deletes a file, and deleting an already-missing key is a no-op", async () => {
    const { storageKey } = await storage.save({ buffer: Buffer.from("x"), suggestedName: "a.png" });

    await storage.delete(storageKey);
    await expect(storage.read(storageKey)).rejects.toThrow();

    // Idempotent: no error the second time either.
    await expect(storage.delete(storageKey)).resolves.toBeUndefined();
  });

  it("refuses to resolve a storage key that tries to escape the root", async () => {
    await expect(storage.read("../outside.txt")).rejects.toThrow(/outside the storage root/);
    await expect(storage.delete("../../outside.txt")).rejects.toThrow(/outside the storage root/);
  });
});

describe("isAllowedAttachmentExtension", () => {
  it("accepts every extension on the allowlist, case-insensitively", () => {
    for (const ext of ALLOWED_ATTACHMENT_EXTENSIONS) {
      expect(isAllowedAttachmentExtension(`file.${ext}`)).toBe(true);
      expect(isAllowedAttachmentExtension(`file.${ext.toUpperCase()}`)).toBe(true);
    }
  });

  it("rejects an extension not on the allowlist", () => {
    expect(isAllowedAttachmentExtension("malware.exe")).toBe(false);
    expect(isAllowedAttachmentExtension("no-extension")).toBe(false);
  });
});

describe("MAX_ATTACHMENT_SIZE_BYTES", () => {
  it("is a sane positive limit", () => {
    expect(MAX_ATTACHMENT_SIZE_BYTES).toBeGreaterThan(0);
  });
});
