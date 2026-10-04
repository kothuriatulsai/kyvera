import * as protoRequestRepository from "../repositories/protoRequestRepository";
import { NotFoundError } from "./errors";

export async function listProtoRequests(projectId?: string) {
  return protoRequestRepository.findMany(projectId ? { projectId } : {});
}

export async function getProtoRequest(id: string) {
  const protoRequest = await protoRequestRepository.findById(id);
  if (!protoRequest) {
    throw new NotFoundError(`Proto Request ${id} not found`);
  }
  return protoRequest;
}
