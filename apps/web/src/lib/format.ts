import type { ProjectPhase, ProjectStatus } from '@kyvera/shared-types'

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export const PROJECT_PHASE_LABELS: Record<ProjectPhase, string> = {
  PROTO: 'Proto',
  BULK: 'Bulk',
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
}
