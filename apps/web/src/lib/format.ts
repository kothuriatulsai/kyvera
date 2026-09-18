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

/**
 * The persisted status can lag behind reality (see useProductDelays). Prefer
 * the live delay result when we have it, but never override a manually-set
 * BLOCKED, mirroring what the API's recompute does.
 */
export function effectiveStatus(persisted: ProductStatus, liveDelayed: boolean | undefined): ProductStatus {
  if (persisted === 'BLOCKED' || liveDelayed === undefined) return persisted
  return liveDelayed ? 'DELAYED' : 'ON_TRACK'
}
