import type { Prisma, UserRole } from "@prisma/client";
import type { Task } from "@kyvera/shared-types";
import * as techPackRepository from "../repositories/techPackRepository";
import * as projectRepository from "../repositories/projectRepository";
import type { Actor } from "./tokenService";
import * as visibility from "./visibility";

/**
 * ADR 0014: "My tasks" - computed on every request, never stored. Every
 * query here is scoped through `visibility`'s existing exports
 * (`visibleProjectIds`/`techPackStageWhere`) exactly like any other SOP
 * read, so a task can never point at something its viewer isn't allowed to
 * open. What's layered on top here is purely "does this already-reachable
 * item need this role's action right now" - a different question from
 * visibility's "can they reach it at all".
 */

async function designerTasks(actor: Actor): Promise<Task[]> {
  const visibleIds = await visibility.visibleProjectIds(actor);
  const scope: Prisma.TechPackWhereInput = {
    voidedAt: null,
    ...(visibleIds !== null ? { projectId: { in: visibleIds } } : {}),
  };

  const [withoutVersions, withVersions] = await Promise.all([
    techPackRepository.findManyWithLatestVersion({ ...scope, versions: { none: {} } }),
    techPackRepository.findManyWithLatestVersion({ ...scope, versions: { some: {} } }),
  ]);

  const tasks: Task[] = withoutVersions.map((tp) => ({
    type: "UPLOAD_FIRST_VERSION",
    message: `Upload v1 for ${tp.code}.`,
    link: `/tech-packs/${tp.id}`,
    projectId: tp.projectId,
    projectCode: tp.project.code,
    techPackId: tp.id,
    techPackCode: tp.code,
  }));

  for (const tp of withVersions) {
    const latest = tp.versions[0];
    const latestRemark = latest.remarks[0];
    if (latest.confirmation === null && latestRemark && latestRemark.author.role !== "PRODUCT_DESIGNER") {
      tasks.push({
        type: "ADDRESS_REMARKS",
        message: `New remarks on ${tp.code} v${latest.versionNumber}.`,
        link: `/tech-packs/${tp.id}`,
        projectId: tp.projectId,
        projectCode: tp.project.code,
        techPackId: tp.id,
        techPackCode: tp.code,
        versionNumber: latest.versionNumber,
      });
    }
  }

  return tasks;
}

async function engineeringTasks(actor: Actor): Promise<Task[]> {
  const visibleIds = await visibility.visibleProjectIds(actor);
  const scope: Prisma.TechPackWhereInput = {
    voidedAt: null,
    versions: { some: {} },
    ...(visibleIds !== null ? { projectId: { in: visibleIds } } : {}),
  };

  const withVersions = await techPackRepository.findManyWithLatestVersion(scope);

  const tasks: Task[] = [];
  for (const tp of withVersions) {
    const latest = tp.versions[0];
    const latestRemark = latest.remarks[0];
    const waitingOnDesigner = latestRemark !== undefined && latestRemark.author.role === "ENGINEERING";
    if (latest.confirmation === null && !waitingOnDesigner) {
      tasks.push({
        type: "REVIEW_VERSION",
        message: `Review ${tp.code} v${latest.versionNumber}.`,
        link: `/tech-packs/${tp.id}`,
        projectId: tp.projectId,
        projectCode: tp.project.code,
        techPackId: tp.id,
        techPackCode: tp.code,
        versionNumber: latest.versionNumber,
      });
    }
  }
  return tasks;
}

async function managementTasks(): Promise<Task[]> {
  const stageWhere = visibility.techPackStageWhere("MANAGEMENT");
  if (stageWhere === null) return [];

  const techPacks = await techPackRepository.findManyForDecisionTasks({
    voidedAt: null,
    ...stageWhere,
  });

  const tasks: Task[] = [];
  for (const tp of techPacks) {
    const hasPendingNewerVersion = tp.versions[0]?.confirmation === null;
    if (hasPendingNewerVersion) continue;
    const latestConfirmed = tp.versions.find((v) => v.confirmation !== null);
    if (!latestConfirmed || latestConfirmed.approval !== null) continue;
    tasks.push({
      type: "DECIDE_VERSION",
      message: `Decide ${tp.code} v${latestConfirmed.versionNumber}.`,
      link: `/tech-packs/${tp.id}`,
      projectId: tp.projectId,
      projectCode: tp.project.code,
      techPackId: tp.id,
      techPackCode: tp.code,
      versionNumber: latestConfirmed.versionNumber,
    });
  }
  return tasks;
}

async function pmoTasks(): Promise<Task[]> {
  const projects = await projectRepository.findManyWithoutTechPacks();
  return projects.map((project) => ({
    type: "WAITING_FOR_DESIGN",
    message: `Waiting for design on ${project.code}.`,
    link: `/projects/${project.id}`,
    projectId: project.id,
    projectCode: project.code,
  }));
}

const TASK_LISTS: Partial<Record<UserRole, (actor: Actor) => Promise<Task[]>>> = {
  PRODUCT_DESIGNER: designerTasks,
  ENGINEERING: engineeringTasks,
  MANAGEMENT: managementTasks,
  PMO: pmoTasks,
};

export async function listMyTasks(actor: Actor): Promise<Task[]> {
  const list = TASK_LISTS[actor.role];
  if (!list) return [];
  return list(actor);
}
