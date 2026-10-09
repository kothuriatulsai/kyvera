import * as attachmentRepository from "../repositories/attachmentRepository";
import { attachmentStorage } from "./storage";
import type { Actor } from "./tokenService";
import * as visibility from "./visibility";
import { NotFoundError } from "./errors";

// Downloads go through this (authenticated) endpoint, never a static file
// server - see ADR 0008 and CLAUDE.md's Slice A notes.
export async function downloadAttachment(actor: Actor, id: string) {
  // Every Attachment today belongs to a TechPackVersion (the only owner FK
  // that exists yet - ADR 0008) - this will need a case per owner type once
  // Attachment gains others later.
  const scope = await attachmentRepository.findWithVisibilityScope(id);
  if (!scope || !scope.techPackVersion) {
    throw new NotFoundError(`Attachment ${id} not found`);
  }
  await visibility.assertAttachmentVisible(actor, {
    projectId: scope.techPackVersion.techPack.projectId,
    techPackVersionId: scope.techPackVersionId!,
    confirmed: scope.techPackVersion.confirmation !== null,
  });

  const attachment = await attachmentRepository.findById(id);
  if (!attachment) {
    throw new NotFoundError(`Attachment ${id} not found`);
  }
  const buffer = await attachmentStorage.read(attachment.storageKey);
  return { attachment, buffer };
}
