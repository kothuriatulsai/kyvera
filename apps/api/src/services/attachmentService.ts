import * as attachmentRepository from "../repositories/attachmentRepository";
import { attachmentStorage } from "./storage";
import type { Actor } from "./tokenService";
import * as visibility from "./visibility";
import { NotFoundError } from "./errors";

// Downloads go through this (authenticated) endpoint, never a static file
// server - see ADR 0008 and CLAUDE.md's Slice A notes.
//
// ADR 0015 added a second owner: a ProtoRequest's PO. Each owner branch has
// its own visibility rule (visibility.ts), so the case is picked here based
// on which FK is set, same shape ADR 0008's own comment anticipated
// ("more owner columns are added here as later slices need them").
export async function downloadAttachment(actor: Actor, id: string) {
  const scope = await attachmentRepository.findWithVisibilityScope(id);
  if (!scope) {
    throw new NotFoundError(`Attachment ${id} not found`);
  }

  if (scope.techPackVersion) {
    await visibility.assertAttachmentVisible(actor, {
      projectId: scope.techPackVersion.techPack.projectId,
      techPackVersionId: scope.techPackVersionId!,
      confirmed: scope.techPackVersion.confirmation !== null,
    });
  } else if (scope.protoRequest) {
    await visibility.assertProtoRequestPoVisible(actor, { projectId: scope.protoRequest.projectId });
  } else {
    throw new NotFoundError(`Attachment ${id} not found`);
  }

  const attachment = await attachmentRepository.findById(id);
  if (!attachment) {
    throw new NotFoundError(`Attachment ${id} not found`);
  }
  const buffer = await attachmentStorage.read(attachment.storageKey);
  return { attachment, buffer };
}
