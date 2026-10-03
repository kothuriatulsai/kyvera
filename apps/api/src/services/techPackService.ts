import type { Prisma } from "@prisma/client";
import * as techPackRepository from "../repositories/techPackRepository";
import * as techPackVersionRepository from "../repositories/techPackVersionRepository";
import * as projectRepository from "../repositories/projectRepository";
import { prisma } from "../repositories/prismaClient";
import { attachmentStorage, isAllowedAttachmentExtension, MAX_ATTACHMENT_SIZE_BYTES } from "./storage";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export interface UploadedFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CreateTechPackInput {
  projectId: string;
  notes?: string;
  files: UploadedFile[];
}

export interface UploadTechPackVersionInput {
  notes?: string;
  files: UploadedFile[];
}

interface SavedFile {
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

// Defence in depth: `attachmentUpload` (the multer middleware) already enforces
// the allowlist and size limit at the HTTP layer, but a service that can be
// reached another way later (or a test that builds the input directly) should
// not silently lose that policy.
function validateFiles(files: UploadedFile[]) {
  if (files.length === 0) {
    throw new ValidationError("At least one file is required");
  }
  for (const file of files) {
    if (!isAllowedAttachmentExtension(file.originalName)) {
      throw new ValidationError(`${file.originalName} has a file type that is not allowed`);
    }
    if (file.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new ValidationError(`${file.originalName} exceeds the maximum upload size`);
    }
  }
}

// Writes bytes to storage *before* the enclosing interactive transaction, not
// inside it: Prisma's default transaction timeout (5s) is sized for database
// work, not for however long saving one or several files takes, and a
// transaction that gets killed by that timeout after `attachmentStorage.save()`
// already ran would leave the file on disk with no `Attachment` row pointing
// at it. Saving first means the transaction below only ever does DB writes;
// `deleteSavedFiles` is the counterpart cleanup if that transaction then fails
// for an unrelated reason (a 404/409 check, a constraint violation, ...).
async function saveFilesToStorage(files: UploadedFile[]): Promise<SavedFile[]> {
  const saved: SavedFile[] = [];
  try {
    for (const file of files) {
      const { storageKey } = await attachmentStorage.save({
        buffer: file.buffer,
        suggestedName: file.originalName,
      });
      saved.push({
        storageKey,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      });
    }
    return saved;
  } catch (err) {
    await deleteSavedFiles(saved);
    throw err;
  }
}

// Best-effort: a delete failure here must not hide the original error that
// triggered the cleanup, so failures are swallowed rather than rethrown. A
// storage key that fails to delete is an orphan file, not a correctness bug -
// the `Attachment` row that would have pointed at it was never written.
async function deleteSavedFiles(saved: SavedFile[]) {
  await Promise.allSettled(saved.map((file) => attachmentStorage.delete(file.storageKey)));
}

async function createAttachmentRows(
  saved: SavedFile[],
  uploadedById: string,
  techPackVersionId: string,
  tx: Prisma.TransactionClient,
) {
  for (const file of saved) {
    await tx.attachment.create({
      data: {
        storageKey: file.storageKey,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        uploadedBy: { connect: { id: uploadedById } },
        techPackVersion: { connect: { id: techPackVersionId } },
      },
    });
  }
}

export async function createTechPack(createdById: string, input: CreateTechPackInput) {
  validateFiles(input.files);

  const saved = await saveFilesToStorage(input.files);

  let techPackId: string;
  try {
    techPackId = await prisma.$transaction(async (tx) => {
      // Locks the Project row so "at most one non-voided TechPack per Project
      // per phase" and the insert that follows it are atomic together - two
      // concurrent creates for the same Project now serialize on this lock
      // instead of both reading "no active TechPack yet" and both proceeding.
      const project = await projectRepository.lockById(input.projectId, tx);
      if (!project) {
        throw new NotFoundError(`Project ${input.projectId} not found`);
      }

      const active = await techPackRepository.findActiveByProjectAndPhase(project.id, project.phase, tx);
      if (active) {
        throw new ConflictError(
          `Project ${project.id} already has an active Tech Pack (${active.code}) for its current phase`,
        );
      }

      const techPack = await techPackRepository.create(
        {
          project: { connect: { id: project.id } },
          phase: project.phase,
          createdBy: { connect: { id: createdById } },
        },
        tx,
      );

      const version = await techPackVersionRepository.create(
        {
          techPack: { connect: { id: techPack.id } },
          versionNumber: 1,
          notes: input.notes,
          uploadedBy: { connect: { id: createdById } },
        },
        tx,
      );

      await createAttachmentRows(saved, createdById, version.id, tx);

      return techPack.id;
    });
  } catch (err) {
    await deleteSavedFiles(saved);
    throw err;
  }

  return getTechPack(techPackId);
}

export async function uploadTechPackVersion(
  uploadedById: string,
  techPackId: string,
  input: UploadTechPackVersionInput,
) {
  validateFiles(input.files);

  const saved = await saveFilesToStorage(input.files);

  try {
    await prisma.$transaction(async (tx) => {
      const techPack = await techPackRepository.lockById(techPackId, tx);
      if (!techPack) {
        throw new NotFoundError(`Tech Pack ${techPackId} not found`);
      }
      if (techPack.voidedAt) {
        throw new ConflictError(`Tech Pack ${techPack.code} is voided and cannot take a new version`);
      }
      if (await techPackVersionRepository.hasApprovedVersion(techPackId, tx)) {
        throw new ConflictError(
          `Tech Pack ${techPack.code} is already approved and cannot take a new version`,
        );
      }

      const latest = await techPackVersionRepository.findLatestByTechPack(techPackId, tx);
      const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

      const version = await techPackVersionRepository.create(
        {
          techPack: { connect: { id: techPackId } },
          versionNumber: nextVersionNumber,
          notes: input.notes,
          uploadedBy: { connect: { id: uploadedById } },
        },
        tx,
      );

      await createAttachmentRows(saved, uploadedById, version.id, tx);
    });
  } catch (err) {
    await deleteSavedFiles(saved);
    throw err;
  }

  return getTechPack(techPackId);
}

export async function listTechPacks(projectId?: string) {
  return techPackRepository.findMany(projectId ? { projectId } : {});
}

export async function getTechPack(id: string) {
  const techPack = await techPackRepository.findById(id);
  if (!techPack) {
    throw new NotFoundError(`Tech Pack ${id} not found`);
  }
  return techPack;
}
