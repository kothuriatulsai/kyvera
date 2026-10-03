import * as attachmentRepository from "../repositories/attachmentRepository";
import { attachmentStorage } from "./storage";
import { NotFoundError } from "./errors";

// Downloads go through this (authenticated) endpoint, never a static file
// server - see ADR 0008 and CLAUDE.md's Slice A notes.
export async function downloadAttachment(id: string) {
  const attachment = await attachmentRepository.findById(id);
  if (!attachment) {
    throw new NotFoundError(`Attachment ${id} not found`);
  }
  const buffer = await attachmentStorage.read(attachment.storageKey);
  return { attachment, buffer };
}
