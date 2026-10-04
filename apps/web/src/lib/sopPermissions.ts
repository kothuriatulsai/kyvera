import type { Project, TechPackListItem, UserRole } from '@kyvera/shared-types'

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
