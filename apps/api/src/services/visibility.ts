import type { UserRole } from "@prisma/client";
import * as projectMemberRepository from "../repositories/projectMemberRepository";
import * as projectRepository from "../repositories/projectRepository";
import * as protoRequestRepository from "../repositories/protoRequestRepository";
import * as techPackRepository from "../repositories/techPackRepository";
import { NotFoundError } from "./errors";
import type { Actor } from "./tokenService";

/**
 * ADR 0013: the one module every SOP service goes through to decide who
 * sees what. Two layers:
 *
 * - Layer A (project membership) decides *which Projects* a role sees at
 *   all - `assertProjectVisible` / `visibleProjectIds`.
 * - Layer B (stage) decides *which parts* of a visible Project's Tech Packs
 *   a role sees, and when - everything below that.
 *
 * Every visibility failure is a 404 (`NotFoundError`), never a 403: a
 * Project/Tech Pack/version a role can't see doesn't exist from where
 * they're standing, the same way a malformed or unknown id already 404s
 * elsewhere in this codebase (see `uuidParam`). This also means there is no
 * separate "does this id exist at all" check anywhere here - a nonexistent
 * id has no membership row and no matching Tech Pack either, so the same
 * code path that rejects a real-but-invisible resource also rejects one
 * that was never real to begin with.
 */

// Bypass Layer A entirely - every Project, unconditionally. Exported for the
// membership-candidates listing (projectService.listMembershipCandidates) -
// adding one of these roles as a member would be a no-op roster entry.
export const SEE_ALL_ROLES: readonly UserRole[] = ["ADMIN", "PMO", "MANAGEMENT"];

export function canSeeAllProjects(role: UserRole): boolean {
  return SEE_ALL_ROLES.includes(role);
}

export async function isProjectMember(projectId: string, userId: string): Promise<boolean> {
  const row = await projectMemberRepository.findByProjectAndUser(projectId, userId);
  return row !== null;
}

/**
 * Layer A gate for a single Project - every detail read and every write
 * action that targets one project calls this once, early. Also the only
 * existence check most callers need: a non-see-all role's membership lookup
 * already 404s a nonexistent id for free (no project, no membership row
 * either), but a see-all role's check would otherwise never notice one -
 * `canSeeAllProjects` returns before any lookup at all - so this checks
 * existence explicitly up front, for every role, before that branch.
 */
export async function assertProjectVisible(actor: Actor, projectId: string): Promise<void> {
  if (!(await projectRepository.exists(projectId))) {
    throw new NotFoundError(`Project ${projectId} not found`);
  }
  if (canSeeAllProjects(actor.role)) return;
  if (await isProjectMember(projectId, actor.id)) return;
  throw new NotFoundError(`Project ${projectId} not found`);
}

/**
 * Layer A gate starting from a TechPack id rather than a Project id - for
 * every TechPack write action (upload a version, remark, confirm, decide)
 * to check *before* doing anything expensive (saving files, opening a
 * transaction), using only a narrow `{ projectId }` select rather than the
 * full detail include `visibleTechPackDetail` needs. Returns the projectId,
 * since every caller needs it again right after anyway.
 */
export async function assertTechPackVisibleById(actor: Actor, techPackId: string): Promise<string> {
  const techPack = await techPackRepository.findScopeById(techPackId);
  if (!techPack) {
    throw new NotFoundError(`Tech Pack ${techPackId} not found`);
  }
  await assertProjectVisible(actor, techPack.projectId);
  return techPack.projectId;
}

/** The project-id scope for a list query. `null` means "no restriction" -
 * the caller leaves `projectId` out of its `where` entirely rather than
 * building an `{ in: [...] }` filter that happens to match everything. */
export async function visibleProjectIds(actor: Actor): Promise<string[] | null> {
  if (canSeeAllProjects(actor.role)) return null;
  const rows = await projectMemberRepository.findProjectIdsForUser(actor.id);
  return rows.map((row) => row.projectId);
}

// ---------------------------------------------------------------------------
// Layer B - which parts of a visible Project's Tech Packs a role sees.
// ---------------------------------------------------------------------------

/** Finance/Merchandiser never browse Tech Packs directly (ADR 0013) - their
 * only lens into one is the Proto Request it produced, see
 * `assertAttachmentVisible`. */
function canBrowseTechPacks(role: UserRole): boolean {
  return role !== "FINANCE" && role !== "MERCHANDISER";
}

/**
 * `GET /tech-packs` (optionally `?projectId=`): the stage-level filter
 * layered on top of `visibleProjectIds`'s project scope. `null` means "show
 * nothing" (Finance/Merchandiser) - the caller skips the query rather than
 * fighting Prisma with an always-false `where`.
 */
export function techPackStageWhere(role: UserRole): Record<string, unknown> | null {
  if (!canBrowseTechPacks(role)) return null;
  if (role === "ENGINEERING") return { versions: { some: {} } };
  if (role === "MANAGEMENT") return { versions: { some: { confirmation: { isNot: null } } } };
  return {};
}

interface VersionLike {
  versionNumber: number;
  confirmation: unknown;
  remarks: unknown[];
}

interface TechPackLike {
  projectId: string;
  versions: VersionLike[];
}

/**
 * `GET /tech-packs/:id`: layer A then layer B in one call, so every reader
 * gets the same treatment. Throws 404 if the Project isn't visible, or if
 * nothing about this Tech Pack is visible to this role at all (Finance/
 * Merchandiser: always; Engineering: before any version exists; Management:
 * before any version is confirmed). Otherwise returns a shaped copy -
 * Management's `versions` is narrowed to confirmed ones with `remarks`
 * stripped from each, plus `hasPendingNewerVersion` if the real latest
 * version (versions are loaded newest-first) is still unconfirmed; every
 * other role gets the Tech Pack unchanged.
 */
export async function visibleTechPackDetail<T extends TechPackLike>(
  actor: Actor,
  techPack: T,
): Promise<T & { hasPendingNewerVersion?: boolean }> {
  await assertProjectVisible(actor, techPack.projectId);

  if (!canBrowseTechPacks(actor.role)) {
    throw new NotFoundError("Tech Pack not found");
  }
  if (actor.role === "ENGINEERING" && techPack.versions.length === 0) {
    throw new NotFoundError("Tech Pack not found");
  }
  if (actor.role === "MANAGEMENT") {
    const confirmed = techPack.versions.filter((v) => v.confirmation !== null);
    if (confirmed.length === 0) {
      throw new NotFoundError("Tech Pack not found");
    }
    return {
      ...techPack,
      versions: confirmed.map((v) => ({ ...v, remarks: [] })),
      hasPendingNewerVersion: techPack.versions[0]?.confirmation === null,
    };
  }
  return techPack;
}

/**
 * Whether Management's "no remarks" rule applies - used by the remarks-list
 * endpoint, which withholds content even for an otherwise-visible (confirmed)
 * version. Absolute, unlike the confirmation-gated version check below: a
 * confirmed version is visible to Management, its remarks never are.
 */
export function remarksVisibleTo(role: UserRole): boolean {
  return role !== "MANAGEMENT";
}

/**
 * Gate for a single version's sub-resources (the remarks list today) that
 * aren't reached through `visibleTechPackDetail`'s array filtering - same
 * layer A/B rule: is this version reachable by browsing at all.
 */
export async function assertVersionBrowsable(
  actor: Actor,
  techPack: { projectId: string },
  version: { confirmation: unknown },
): Promise<void> {
  await assertProjectVisible(actor, techPack.projectId);
  if (!canBrowseTechPacks(actor.role)) {
    throw new NotFoundError("Tech Pack version not found");
  }
  if (actor.role === "MANAGEMENT" && version.confirmation === null) {
    throw new NotFoundError("Tech Pack version not found");
  }
}

/**
 * `GET /attachments/:id/download`: deliberately *not* the same rule as
 * `assertVersionBrowsable` - Finance/Merchandiser reach a version's files
 * only through the Proto Request it produced, never by browsing the Tech
 * Pack itself, so their check is "does a Proto Request pin exactly this
 * version", not "can this role browse this Tech Pack".
 */
export async function assertAttachmentVisible(
  actor: Actor,
  info: { projectId: string; techPackVersionId: string; confirmed: boolean },
): Promise<void> {
  await assertProjectVisible(actor, info.projectId);

  if (actor.role === "FINANCE" || actor.role === "MERCHANDISER") {
    const pinned = await protoRequestRepository.existsForVersion(info.techPackVersionId);
    if (!pinned) throw new NotFoundError("Attachment not found");
    return;
  }
  if (actor.role === "MANAGEMENT" && !info.confirmed) {
    throw new NotFoundError("Attachment not found");
  }
}
