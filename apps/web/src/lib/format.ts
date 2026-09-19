import type { ProductStatus } from '@kyvera/shared-types'

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDays(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

export const STATUS_LABELS: Record<ProductStatus, string> = {
  ON_TRACK: 'On track',
  DELAYED: 'Delayed',
  BLOCKED: 'Blocked',
}
