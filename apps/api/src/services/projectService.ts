import * as projectRepository from "../repositories/projectRepository";
import { NotFoundError } from "./errors";

export interface CreateProjectInput {
  name: string;
  productName: string;
  productCategory?: string;
}

// createdById is always the authenticated actor - unlike Product.ownerId in
// the old module, the SOP doesn't describe creating a Project on someone
// else's behalf, so there's no separate id to validate against `users`.
export async function createProject(createdById: string, input: CreateProjectInput) {
  return projectRepository.create({
    name: input.name,
    productName: input.productName,
    productCategory: input.productCategory,
    createdBy: { connect: { id: createdById } },
  });
}

export async function listProjects() {
  return projectRepository.findMany();
}

export async function getProject(id: string) {
  const project = await projectRepository.findById(id);
  if (!project) {
    throw new NotFoundError(`Project ${id} not found`);
  }
  return project;
}
