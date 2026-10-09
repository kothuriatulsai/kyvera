import * as protoRequestRepository from "../repositories/protoRequestRepository";
import type { Actor } from "./tokenService";
import * as visibility from "./visibility";
import { NotFoundError } from "./errors";

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
