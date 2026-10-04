import type { UserRole } from '@kyvera/shared-types'

/**
 * Who may do what in the SOP domain (Project, TechPack, ...), one function per
 * action, mirroring the API's own role gates exactly (apps/api/src/routes/
 * *Routes.ts) so there is a single place to check instead of scattering role
 * (and, later, state) checks through components. The server enforces all of
 * this regardless - these functions decide what to *show*, the same courtesy
 * `ProductActions` already extends for the old module.
 *
 * Grows one function per screen as that screen lands: `canCreateProject` is
 * the only one needed so far.
 */
export function canCreateProject(role: UserRole): boolean {
  return role === 'PMO' || role === 'ADMIN'
}
