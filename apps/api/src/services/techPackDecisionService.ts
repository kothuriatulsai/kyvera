import { Prisma } from "@prisma/client";
import type { ApprovalDecision } from "@prisma/client";
import * as techPackRepository from "../repositories/techPackRepository";
import * as techPackVersionRepository from "../repositories/techPackVersionRepository";
import * as techPackConfirmationRepository from "../repositories/techPackConfirmationRepository";
import * as techPackApprovalRepository from "../repositories/techPackApprovalRepository";
import * as protoRequestRepository from "../repositories/protoRequestRepository";
import { prisma } from "../repositories/prismaClient";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export interface DecideTechPackVersionInput {
  decision: ApprovalDecision;
  notes?: string;
}

// Management's final decision (SOP Stage 3). Row-locks the TechPack, same as
// confirmTechPackVersion, so this can't race a concurrent version upload or
// another decision on the same TechPack - e.g. approving a version that
// stopped being the latest a moment earlier.
export async function decideTechPackVersion(
  decidedById: string,
  techPackId: string,
  versionNumber: number,
  input: DecideTechPackVersionInput,
) {
  if (input.decision === "REJECTED" && (input.notes === undefined || input.notes.trim() === "")) {
    throw new ValidationError("notes is required when rejecting (it becomes the TechPack's voidReason)");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const techPack = await techPackRepository.lockById(techPackId, tx);
      if (!techPack) {
        throw new NotFoundError(`Tech Pack ${techPackId} not found`);
      }

      const version = await techPackVersionRepository.findByTechPackAndNumber(techPackId, versionNumber, tx);
      if (!version) {
        throw new NotFoundError(`Tech Pack ${techPack.code} has no version ${versionNumber}`);
      }

      if (techPack.voidedAt) {
        throw new ConflictError(`Tech Pack ${techPack.code} is voided`);
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

      // The ADR 0006 case this guards against: v2 confirmed, v3 uploaded
      // afterward with no confirmation of its own - "some version of this
      // TechPack is confirmed" must not be enough, only *this* version's.
      const confirmation = await techPackConfirmationRepository.findByVersion(version.id, tx);
      if (!confirmation) {
        throw new ConflictError(
          `Version ${versionNumber} of Tech Pack ${techPack.code} has no Engineering confirmation`,
        );
      }

      await techPackApprovalRepository.create(
        {
          techPackVersion: { connect: { id: version.id } },
          decision: input.decision,
          decidedBy: { connect: { id: decidedById } },
          notes: input.notes,
        },
        tx,
      );

      if (input.decision === "APPROVED") {
        const protoRequest = await protoRequestRepository.create(
          {
            project: { connect: { id: techPack.projectId } },
            techPackVersion: { connect: { id: version.id } },
          },
          tx,
        );
        const approvedTechPack = await techPackRepository.findById(techPackId, tx);
        return { decision: "APPROVED" as const, techPack: approvedTechPack, protoRequest };
      }

      await techPackRepository.voidTechPack(
        techPackId,
        { voidedById: decidedById, voidReason: input.notes! },
        tx,
      );

      // The SOP's revision loop after a rejection: a new TP number under the
      // same Project/phase, linked back via supersedesId, with no versions of
      // its own yet - the designer uploads v1 to it next, the same way
      // uploadTechPackVersion already handles a TechPack with zero versions
      // (nextVersionNumber falls back to 1 when there's no "latest" yet).
      const successor = await techPackRepository.create(
        {
          project: { connect: { id: techPack.projectId } },
          phase: techPack.phase,
          createdBy: { connect: { id: decidedById } },
          supersedes: { connect: { id: techPackId } },
        },
        tx,
      );
      const successorDetail = await techPackRepository.findById(successor.id, tx);

      return { decision: "REJECTED" as const, techPack: successorDetail, protoRequest: null };
    });
  } catch (err) {
    // Defence in depth behind the explicit checks above: the unique
    // constraint on TechPackApproval.techPackVersionId is the backstop if two
    // decisions on the same version still land inside the lock window together.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError(`Version ${versionNumber} of Tech Pack ${techPackId} already has a decision`);
    }
    throw err;
  }
}
