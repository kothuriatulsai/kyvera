import type { ProductListEntry, ProductListItem } from '@kyvera/shared-types'

/**
 * Products the viewer sees in full (as admin, owner or assigned manager). The
 * pages built so far only know how to render those; the assignee view gets its
 * own UI in the frontend session, so for now assignee-only entries are skipped.
 */
export function fullViewsOnly(entries: ProductListEntry[]): ProductListItem[] {
  return entries.filter((entry): entry is ProductListItem => entry.view === 'full')
}
