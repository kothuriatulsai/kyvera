import type { UserRole } from "@prisma/client";
import * as projectMemberRepository from "../repositories/projectMemberRepository";
import * as projectRepository from "../repositories/projectRepository";
import * as userRepository from "../repositories/userRepository";
import { prisma } from "../repositories/prismaClient";
import type { Actor } from "./tokenService";
import * as visibility from "./visibility";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export interface CreateProjectInput {
  name: string;
  productName: string;
  productCategory?: string;
}

// createdById is always the authenticated actor - unlike Product.ownerId in
// the old module, the SOP doesn't describe creating a Project on someone
// else's behalf, so there's no separate id to validate against `users`.
export async function createProject(createdById: string, input: CreateProjectInput) {
  const project = await projectRepository.create({
    name: input.name,
    productName: input.productName,
    productCategory: input.productCategory,
    createdBy: { connect: { id: createdById } },
  });

  // ADR 0013: the creator is always a member of their own Project, even
  // though PMO/ADMIN already see every Project regardless (layer A) - this
  // is a roster/audit record, not a visibility grant, and happens for every
  // creator (PMO or ADMIN - projectRoutes allows both), not just PMO.
  await addMemberRow(project.id, createdById, createdById);

  return project;
}

export async function listProjects(actor: Actor) {
  const projectIds = await visibility.visibleProjectIds(actor);
  return projectRepository.findMany(projectIds === null ? {} : { id: { in: projectIds } });
}

export async function getProject(actor: Actor, id: string) {
  await visibility.assertProjectVisible(actor, id);
  const project = await projectRepository.findById(id);
  if (!project) {
    throw new NotFoundError(`Project ${id} not found`);
  }
  return project;
}

// ---------------------------------------------------------------------------
// Membership (ADR 0013, layer A). Read is open to anyone who can see the
// Project; add/remove are PMO/ADMIN-only, enforced by the route.
// ---------------------------------------------------------------------------

async function addMemberRow(projectId: string, userId: string, addedById: string) {
  return prisma.$transaction(async (tx) => {
    const member = await projectMemberRepository.create(
      {
        project: { connect: { id: projectId } },
        user: { connect: { id: userId } },
        addedBy: { connect: { id: addedById } },
      },
      tx,
    );
    await projectMemberRepository.createHistoryEntry(
      {
        project: { connect: { id: projectId } },
        user: { connect: { id: userId } },
        action: "ADDED",
        by: { connect: { id: addedById } },
      },
      tx,
    );
    return member;
  });
}

export async function listMembers(actor: Actor, projectId: string) {
  await visibility.assertProjectVisible(actor, projectId);
  return projectMemberRepository.findByProject(projectId);
}

// Roles that already see every Project regardless of membership (ADR 0013) -
// adding one as a member would be a no-op roster entry with no visibility
// effect, so the picker (and this check) excludes them.
function isMembershipEligibleRole(role: UserRole): boolean {
  return !visibility.canSeeAllProjects(role);
}

export async function addMember(actor: Actor, projectId: string, targetUserId: string) {
  await visibility.assertProjectVisible(actor, projectId);

  const target = await userRepository.findSafeById(targetUserId);
  if (!target) {
    throw new NotFoundError(`User ${targetUserId} not found`);
  }
  if (!target.isActive) {
    throw new ValidationError("Only active users can be added to a Project");
  }
  if (!isMembershipEligibleRole(target.role)) {
    throw new ValidationError(`${target.role} already sees every Project and cannot be added as a member`);
  }
  if (await visibility.isProjectMember(projectId, targetUserId)) {
    throw new ConflictError(`${target.name} is already a member of this Project`);
  }

  return addMemberRow(projectId, targetUserId, actor.id);
}

export async function removeMember(actor: Actor, projectId: string, targetUserId: string) {
  await visibility.assertProjectVisible(actor, projectId);

  if (!(await visibility.isProjectMember(projectId, targetUserId))) {
    throw new NotFoundError(`${targetUserId} is not a member of this Project`);
  }

  return prisma.$transaction(async (tx) => {
    await projectMemberRepository.remove(projectId, targetUserId, tx);
    await projectMemberRepository.createHistoryEntry(
      {
        project: { connect: { id: projectId } },
        user: { connect: { id: targetUserId } },
        action: "REMOVED",
        by: { connect: { id: actor.id } },
      },
      tx,
    );
  });
}

// The "other direction" (Users page): a user's own membership list.
export function listProjectsForUser(userId: string) {
  return projectMemberRepository.findProjectsForUser(userId);
}

// The member-add picker's candidate list (ADR 0013).
export async function listMembershipCandidates(actor: Actor, projectId: string) {
  await visibility.assertProjectVisible(actor, projectId);
  const currentMembers = await projectMemberRepository.findByProject(projectId);
  const currentMemberIds = currentMembers.map((m) => m.userId);
  return userRepository.findMembershipCandidates([...visibility.SEE_ALL_ROLES], currentMemberIds);
}
