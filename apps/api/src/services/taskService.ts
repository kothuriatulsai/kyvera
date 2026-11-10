import type { Prisma, UserRole } from "@prisma/client";
import type { Task } from "@kyvera/shared-types";
import * as techPackRepository from "../repositories/techPackRepository";
import * as projectRepository from "../repositories/projectRepository";
import * as protoRequestRepository from "../repositories/protoRequestRepository";
import * as protoWorkRepository from "../repositories/protoWorkRepository";
import type { Actor } from "./tokenService";
import * as visibility from "./visibility";

// ADR 0015: the SOP only says "regular intervals" for Stage 5's delivery-date
// reconfirmation prompt (step 22) - a judgment call, not a parsed rule, kept
// here as one constant so it's easy to revisit without touching schema.
const DELIVERY_RECONFIRMATION_INTERVAL_DAYS = 7;

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

// ADR 0015 adds three PMO contributions on top of the existing "waiting for
// design" one: a ProtoRequest with no manufacturer yet, one that's ready to
// confirm (manufacturer + PO, not yet confirmed), and a ProtoWork still
// sitting in the Work Queue. PMO is see-all, so none of this needs project
// scoping, same as the existing "waiting for design" task below.
async function pmoTasks(): Promise<Task[]> {
  const projects = await projectRepository.findManyWithoutTechPacks();
  const tasks: Task[] = projects.map((project) => ({
    type: "WAITING_FOR_DESIGN",
    message: `Waiting for design on ${project.code}.`,
    link: `/projects/${project.id}`,
    projectId: project.id,
    projectCode: project.code,
  }));

  const protoRequests = await protoRequestRepository.findManyForPmoTasks();
  for (const pr of protoRequests) {
    if (pr.manufacturerId === null) {
      tasks.push({
        type: "ASSIGN_MANUFACTURER",
        message: `Assign a manufacturer for ${pr.code}.`,
        link: `/proto-requests/${pr.id}`,
        projectId: pr.projectId,
        projectCode: pr.project.code,
        protoRequestId: pr.id,
        protoRequestCode: pr.code,
      });
    } else if (pr.poAttachment !== null && pr.confirmedAt === null) {
      tasks.push({
        type: "CONFIRM_PROTO_REQUEST",
        message: `Confirm ${pr.code}.`,
        link: `/proto-requests/${pr.id}`,
        projectId: pr.projectId,
        projectCode: pr.project.code,
        protoRequestId: pr.id,
        protoRequestCode: pr.code,
      });
    }
  }

  const queued = await protoWorkRepository.findManyQueued();
  for (const pw of queued) {
    tasks.push({
      type: "ASSIGN_MERCHANDISER",
      message: `Assign a merchandiser for ${pw.code}.`,
      link: `/proto-work/${pw.id}`,
      projectId: pw.projectId,
      projectCode: pw.project.code,
      protoWorkId: pw.id,
      protoWorkCode: pw.code,
    });
  }

  return tasks;
}

// ADR 0015: a ProtoRequest with a manufacturer assigned but no PO yet. Once
// a PO exists, the business rule in protoRequestService.confirmProtoRequest
// already guarantees `confirmedAt` can't be set without one, so no extra
// filter is needed to exclude already-confirmed Proto Requests.
async function financeTasks(actor: Actor): Promise<Task[]> {
  const visibleIds = await visibility.visibleProjectIds(actor);
  const protoRequests = await protoRequestRepository.findManyForFinanceTasks(visibleIds);
  return protoRequests.map((pr) => ({
    type: "UPLOAD_PO",
    message: `Upload the PO for ${pr.code}.`,
    link: `/proto-requests/${pr.id}`,
    projectId: pr.projectId,
    projectCode: pr.project.code,
    protoRequestId: pr.id,
    protoRequestCode: pr.code,
  }));
}

// ADR 0015: a ProtoWork assigned to this actor, not completed, whose latest
// delivery confirmation (or `assignedAt` if there isn't one yet) is older
// than the reconfirmation interval - the SOP's "system should prompt for
// periodic delivery-date confirmation" (step 22).
async function merchandiserTasks(actor: Actor): Promise<Task[]> {
  const visibleIds = await visibility.visibleProjectIds(actor);
  const assigned = await protoWorkRepository.findManyAssignedTo(actor.id, visibleIds);

  const staleBefore = new Date();
  staleBefore.setDate(staleBefore.getDate() - DELIVERY_RECONFIRMATION_INTERVAL_DAYS);

  const tasks: Task[] = [];
  for (const pw of assigned) {
    const lastConfirmedAt = pw.deliveryConfirmations[0]?.confirmedAt ?? pw.assignedAt;
    if (lastConfirmedAt !== null && lastConfirmedAt <= staleBefore) {
      tasks.push({
        type: "RECONFIRM_DELIVERY_DATE",
        message: `Reconfirm the delivery date for ${pw.code}.`,
        link: `/proto-work/${pw.id}`,
        projectId: pw.projectId,
        projectCode: pw.project.code,
        protoWorkId: pw.id,
        protoWorkCode: pw.code,
      });
    }
  }
  return tasks;
}

const TASK_LISTS: Partial<Record<UserRole, (actor: Actor) => Promise<Task[]>>> = {
  PRODUCT_DESIGNER: designerTasks,
  ENGINEERING: engineeringTasks,
  MANAGEMENT: managementTasks,
  PMO: pmoTasks,
  FINANCE: financeTasks,
  MERCHANDISER: merchandiserTasks,
};

export async function listMyTasks(actor: Actor): Promise<Task[]> {
  const list = TASK_LISTS[actor.role];
  if (!list) return [];
  return list(actor);
}
