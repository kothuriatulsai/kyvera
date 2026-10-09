import { Prisma } from "@prisma/client";
import * as techPackRepository from "../repositories/techPackRepository";
import * as techPackVersionRepository from "../repositories/techPackVersionRepository";
import * as techPackRemarkRepository from "../repositories/techPackRemarkRepository";
import * as techPackConfirmationRepository from "../repositories/techPackConfirmationRepository";
import { prisma } from "../repositories/prismaClient";
import type { Actor } from "./tokenService";
import * as visibility from "./visibility";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

const MAX_REMARK_BODY_LENGTH = 5000;

export interface AddTechPackRemarkInput {
  body: string;
}

function findVersionOrThrow(techPackId: string, versionNumber: number, tx?: Prisma.TransactionClient) {
  return techPackVersionRepository
    .findByTechPackAndNumber(techPackId, versionNumber, tx)
    .then((version) => {
      if (!version) {
        throw new NotFoundError(`Tech Pack ${techPackId} has no version ${versionNumber}`);
      }
      return version;
    });
}

// Engineering's feedback loop with the Product Designer (SOP Stage 3). Allowed
// on any version, latest or not - a remark is discussion of review history,
// not an action gated to "the one version currently under review" - and
// refused only once the TechPack itself is voided, since a voided TechPack's
// review is over.
export async function addTechPackRemark(
  actor: Actor,
  techPackId: string,
  versionNumber: number,
  input: AddTechPackRemarkInput,
) {
  await visibility.assertTechPackVisibleById(actor, techPackId);

  const body = input.body.trim();
  if (body === "") {
    throw new ValidationError("body is required and must be a non-empty string");
  }
  if (body.length > MAX_REMARK_BODY_LENGTH) {
    throw new ValidationError(`body must be at most ${MAX_REMARK_BODY_LENGTH} characters`);
  }

  const version = await findVersionOrThrow(techPackId, versionNumber);
  if (version.techPack.voidedAt) {
    throw new ConflictError(`Tech Pack ${version.techPack.code} is voided and cannot take new remarks`);
  }

  return techPackRemarkRepository.create({
    techPackVersion: { connect: { id: version.id } },
    author: { connect: { id: actor.id } },
    body,
  });
}

/** ADR 0013: "no remarks" is a content rule, not a visibility one, for the
 * one role it applies to - a Management-visible (confirmed) version is
 * still a 404 if it isn't visible at all, but once it is, the remarks come
 * back empty rather than the request failing. */
export async function listTechPackRemarks(actor: Actor, techPackId: string, versionNumber: number) {
  const version = await findVersionOrThrow(techPackId, versionNumber);
  await visibility.assertVersionBrowsable(actor, version.techPack, version);
  if (!visibility.remarksVisibleTo(actor.role)) {
    return [];
  }
  return techPackRemarkRepository.findByVersion(version.id);
}

// Engineering's sign-off (SOP Stage 3). Row-locks the TechPack (ADR 0006 point
// 4/CLAUDE.md's decided locking rule) so this can't race a concurrent upload
// that would otherwise make `versionNumber` stop being the latest version
// underneath it, or a concurrent confirm of the same version.
export async function confirmTechPackVersion(actor: Actor, techPackId: string, versionNumber: number) {
  await visibility.assertTechPackVisibleById(actor, techPackId);
  const confirmedById = actor.id;

  try {
    return await prisma.$transaction(async (tx) => {
      const techPack = await techPackRepository.lockById(techPackId, tx);
      if (!techPack) {
        throw new NotFoundError(`Tech Pack ${techPackId} not found`);
      }

      const version = await findVersionOrThrow(techPackId, versionNumber, tx);

      if (techPack.voidedAt) {
        throw new ConflictError(`Tech Pack ${techPack.code} is voided and cannot be confirmed`);
      }
      if (await techPackVersionRepository.hasApprovedVersion(techPackId, tx)) {
        throw new ConflictError(`Tech Pack ${techPack.code} is already approved`);
      }

      const latest = await techPackVersionRepository.findLatestByTechPack(techPackId, tx);
      if (!latest || latest.id !== version.id) {
        throw new ConflictError(
          `Version ${versionNumber} is not the latest version of Tech Pack ${techPack.code}`,
        );
      }

      const existing = await techPackConfirmationRepository.findByVersion(version.id, tx);
      if (existing) {
        throw new ConflictError(
          `Version ${versionNumber} of Tech Pack ${techPack.code} is already confirmed`,
        );
      }

      return techPackConfirmationRepository.create(
        {
          techPackVersion: { connect: { id: version.id } },
          confirmedBy: { connect: { id: confirmedById } },
        },
        tx,
      );
    });
  } catch (err) {
    // Defence in depth behind the explicit `existing` check above: the unique
    // constraint on `techPackVersionId` is the backstop if two confirms on the
    // same version still land inside the lock window together.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError(`Version ${versionNumber} of Tech Pack ${techPackId} is already confirmed`);
    }
    throw err;
  }
}
