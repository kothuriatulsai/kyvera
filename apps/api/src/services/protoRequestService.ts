import { Prisma } from "@prisma/client";
import * as attachmentRepository from "../repositories/attachmentRepository";
import * as protoRequestRepository from "../repositories/protoRequestRepository";
import * as protoWorkRepository from "../repositories/protoWorkRepository";
import { prisma } from "../repositories/prismaClient";
import * as manufacturerService from "./manufacturerService";
import * as notificationService from "./notificationService";
import { attachmentStorage, isAllowedAttachmentExtension, MAX_ATTACHMENT_SIZE_BYTES } from "./storage";
import type { Actor } from "./tokenService";
import * as visibility from "./visibility";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

// ADR 0013: layer A only - a Proto Request has no further stage-level
// restriction of its own. Finance/Merchandiser's restriction is that this
// (plus the attachment download it pins) is the *only* way into the Tech
// Pack domain they get, not an extra gate on Proto Requests themselves.
export async function listProtoRequests(actor: Actor, projectId?: string) {
  const visibleIds = await visibility.visibleProjectIds(actor);
  if (projectId) {
    if (visibleIds !== null && !visibleIds.includes(projectId)) {
      return [];
    }
    return protoRequestRepository.findMany({ projectId });
  }
  return protoRequestRepository.findMany(visibleIds === null ? {} : { projectId: { in: visibleIds } });
}

export async function getProtoRequest(actor: Actor, id: string) {
  const protoRequest = await protoRequestRepository.findById(id);
  if (!protoRequest) {
    throw new NotFoundError(`Proto Request ${id} not found`);
  }
  await visibility.assertProjectVisible(actor, protoRequest.projectId);
  return protoRequest;
}

// ---------------------------------------------------------------------------
// Slice B (ADR 0015), Stage 4 - populated progressively (steps 15-19), each
// write pre-checking layer A via a narrow scope select, same pattern as
// every existing SOP write (ADR 0013 point 5).
// ---------------------------------------------------------------------------

// Layer A was already checked against a fresh read before the transaction
// opened; re-asserting here would just repeat the same membership query
// under the lock. The row can't have moved to a different Project between
// those two reads (ADR 0006: every FK here is onDelete: Restrict, and
// nothing reassigns a ProtoRequest's projectId).
async function lockProtoRequestOrThrow(id: string, tx: Prisma.TransactionClient) {
  const protoRequest = await protoRequestRepository.lockById(id, tx);
  if (!protoRequest) {
    throw new NotFoundError(`Proto Request ${id} not found`);
  }
  return protoRequest;
}

export interface AssignManufacturerInput {
  manufacturerId: string;
  commercialNotes?: string;
}

// Steps 15-16: PMO assigns (or, before confirmation, reassigns) the
// manufacturer and records the commercial-negotiation note.
export async function assignManufacturer(
  actor: Actor,
  protoRequestId: string,
  input: AssignManufacturerInput,
) {
  const scope = await protoRequestRepository.findScopeById(protoRequestId);
  if (!scope) {
    throw new NotFoundError(`Proto Request ${protoRequestId} not found`);
  }
  await visibility.assertProjectVisible(actor, scope.projectId);

  await manufacturerService.requireActiveManufacturer(input.manufacturerId);

  return prisma.$transaction(async (tx) => {
    const protoRequest = await lockProtoRequestOrThrow(protoRequestId, tx);
    if (protoRequest.confirmedAt) {
      throw new ConflictError(`Proto Request ${protoRequest.code} is already confirmed`);
    }

    const updated = await protoRequestRepository.assignManufacturer(
      protoRequestId,
      { manufacturerId: input.manufacturerId, assignedById: actor.id, commercialNotes: input.commercialNotes },
      tx,
    );

    await notificationService.notifyManufacturerAssigned(
      tx,
      actor,
      protoRequestId,
      protoRequest.code,
      protoRequest.projectId,
    );

    return updated;
  });
}

export interface UploadedPoFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

// Step 17: Finance uploads exactly one PO document. Saved to storage *before*
// the transaction, same reasoning as techPackService's file uploads - a
// transaction should only ever do DB work, not however long a file write
// takes - and deleted again if the transaction then fails.
export async function uploadPo(actor: Actor, protoRequestId: string, file: UploadedPoFile) {
  const scope = await protoRequestRepository.findScopeById(protoRequestId);
  if (!scope) {
    throw new NotFoundError(`Proto Request ${protoRequestId} not found`);
  }
  await visibility.assertProjectVisible(actor, scope.projectId);

  if (!isAllowedAttachmentExtension(file.originalName)) {
    throw new ValidationError(`${file.originalName} has a file type that is not allowed`);
  }
  if (file.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new ValidationError(`${file.originalName} exceeds the maximum upload size`);
  }

  const saved = await attachmentStorage.save({ buffer: file.buffer, suggestedName: file.originalName });

  try {
    return await prisma.$transaction(async (tx) => {
      const protoRequest = await lockProtoRequestOrThrow(protoRequestId, tx);
      if (protoRequest.confirmedAt) {
        throw new ConflictError(`Proto Request ${protoRequest.code} is already confirmed`);
      }
      if (!protoRequest.manufacturerId) {
        throw new ValidationError("A manufacturer must be assigned before uploading the PO");
      }

      const existingPo = await tx.attachment.findUnique({ where: { protoRequestId } });
      if (existingPo) {
        throw new ConflictError(`Proto Request ${protoRequest.code} already has a PO uploaded`);
      }

      await attachmentRepository.create(
        {
          storageKey: saved.storageKey,
          originalName: file.originalName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          uploadedBy: { connect: { id: actor.id } },
          protoRequest: { connect: { id: protoRequestId } },
        },
        tx,
      );

      await notificationService.notifyPoUploaded(tx, actor, protoRequestId, protoRequest.code);

      return protoRequestRepository.findById(protoRequestId, tx);
    });
  } catch (err) {
    await attachmentStorage.delete(saved.storageKey).catch(() => undefined);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError(`Proto Request ${protoRequestId} already has a PO uploaded`);
    }
    throw err;
  }
}

export interface ConfirmProtoRequestInput {
  agreedDeliveryDate: Date;
  confirmationNote?: string;
}

// Step 19: PMO confirms - locks in the agreed delivery schedule and releases
// a new ProtoWork to the Work Queue in the same transaction (Stage 5's
// subject is Stage 4's output, ADR 0006 point 8).
export async function confirmProtoRequest(
  actor: Actor,
  protoRequestId: string,
  input: ConfirmProtoRequestInput,
) {
  const scope = await protoRequestRepository.findScopeById(protoRequestId);
  if (!scope) {
    throw new NotFoundError(`Proto Request ${protoRequestId} not found`);
  }
  await visibility.assertProjectVisible(actor, scope.projectId);

  return prisma.$transaction(async (tx) => {
    const protoRequest = await lockProtoRequestOrThrow(protoRequestId, tx);
    if (protoRequest.confirmedAt) {
      throw new ConflictError(`Proto Request ${protoRequest.code} is already confirmed`);
    }
    if (!protoRequest.manufacturerId) {
      throw new ValidationError("A manufacturer must be assigned before confirming");
    }
    const po = await tx.attachment.findUnique({ where: { protoRequestId } });
    if (!po) {
      throw new ValidationError("A PO must be uploaded before confirming");
    }

    await protoRequestRepository.confirm(
      protoRequestId,
      {
        confirmedById: actor.id,
        agreedDeliveryDate: input.agreedDeliveryDate,
        confirmationNote: input.confirmationNote,
      },
      tx,
    );

    const protoWork = await protoWorkRepository.create(
      {
        project: { connect: { id: protoRequest.projectId } },
        protoRequest: { connect: { id: protoRequestId } },
        currentDeliveryDate: input.agreedDeliveryDate,
      },
      tx,
    );

    await notificationService.notifyProtoWorkQueued(tx, actor, protoWork.id, protoWork.code);

    return protoRequestRepository.findById(protoRequestId, tx);
  });
}
