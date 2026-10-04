import type { Project, TechPackDetail, TechPackListItem, TechPackVersion, UserRole } from '@kyvera/shared-types'

/**
 * Who may do what in the SOP domain (Project, TechPack, ...), one function per
 * action, mirroring the API's own role gates exactly (apps/api/src/routes/
 * *Routes.ts) so there is a single place to check instead of scattering role
 * (and, later, state) checks through components. The server enforces all of
 * this regardless - these functions decide what to *show*, the same courtesy
 * `ProductActions` already extends for the old module.
 *
 * Grows one function per screen as that screen lands.
 */
export function canCreateProject(role: UserRole): boolean {
  return role === 'PMO' || role === 'ADMIN'
}

/**
 * PRODUCT_DESIGNER/ADMIN, and only when the Project has no non-voided
 * TechPack for its *current* phase - the exact rule
 * `techPackRepository.findActiveByProjectAndPhase` enforces server-side (a
 * Project can have a voided TechPack from an earlier phase, or one for a
 * different phase after a Proto→Bulk move, without that blocking a new one).
 */
export function canCreateTechPack(
  role: UserRole,
  project: Pick<Project, 'phase'>,
  techPacks: Pick<TechPackListItem, 'phase' | 'voidedAt'>[],
): boolean {
  if (role !== 'PRODUCT_DESIGNER' && role !== 'ADMIN') return false
  return !techPacks.some((tp) => tp.voidedAt === null && tp.phase === project.phase)
}

type TechPackState = Pick<TechPackDetail, 'voidedAt' | 'versions'>

/** TechPack-wide, not per-version - once any version is approved, the Proto
 * Request it created has already fired, so the TechPack's job is done (see
 * techPackVersionRepository.hasApprovedVersion in the API). */
function hasApprovedVersion(techPack: TechPackState): boolean {
  return techPack.versions.some((v) => v.approval?.decision === 'APPROVED')
}

/**
 * PRODUCT_DESIGNER/ADMIN, and only while the TechPack can still take a new
 * version: not voided, and not already approved. True even with zero
 * versions so far (the designer's first upload to a fresh TechPack, or to a
 * rejection's successor) - there's nothing version-specific to check yet.
 */
export function canUploadVersion(role: UserRole, techPack: TechPackState): boolean {
  if (role !== 'PRODUCT_DESIGNER' && role !== 'ADMIN') return false
  return techPack.voidedAt === null && !hasApprovedVersion(techPack)
}

/**
 * ENGINEERING, PRODUCT_DESIGNER or ADMIN, and only while the TechPack isn't
 * voided - deliberately no "latest version" or "approved" check: a remark is
 * discussion of review history and the API allows it on any version right up
 * until the TechPack is voided (see techPackReviewService.addTechPackRemark).
 */
export function canRemark(role: UserRole, techPack: Pick<TechPackDetail, 'voidedAt'>): boolean {
  if (role !== 'ENGINEERING' && role !== 'PRODUCT_DESIGNER' && role !== 'ADMIN') return false
  return techPack.voidedAt === null
}

/**
 * ENGINEERING only, and only on the latest version, while it has no
 * confirmation yet and the TechPack isn't voided or already approved.
 * Callers only ever call this for the latest version (the UI shows no
 * confirm action elsewhere), so there's no separate "is this the latest
 * version" check here - that's structural, not a state this function tests.
 */
export function canConfirm(
  role: UserRole,
  techPack: TechPackState,
  latestVersion: Pick<TechPackVersion, 'confirmation'>,
): boolean {
  if (role !== 'ENGINEERING') return false
  if (techPack.voidedAt !== null || hasApprovedVersion(techPack)) return false
  return latestVersion.confirmation === null
}

/**
 * MANAGEMENT only, and only once the latest version *has* a confirmation
 * (the mirror image of `canConfirm`), while the TechPack isn't voided or
 * already approved.
 */
export function canDecide(
  role: UserRole,
  techPack: TechPackState,
  latestVersion: Pick<TechPackVersion, 'confirmation'>,
): boolean {
  if (role !== 'MANAGEMENT') return false
  if (techPack.voidedAt !== null || hasApprovedVersion(techPack)) return false
  return latestVersion.confirmation !== null
}
