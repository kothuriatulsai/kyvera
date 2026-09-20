import type {
  AssigneeProductSummary,
  ProductListEntry,
  ProductListItem,
} from '@kyvera/shared-types'

/** Products the viewer sees in full (as admin, owner or assigned manager). */
export function fullViewsOnly(entries: ProductListEntry[]): ProductListItem[] {
  return entries.filter((entry): entry is ProductListItem => entry.view === 'full')
}

/** Products the viewer is only assigned to part of: their own stages and nothing more. */
export function assigneeViewsOnly(entries: ProductListEntry[]): AssigneeProductSummary[] {
  return entries.filter((entry): entry is AssigneeProductSummary => entry.view === 'assignee')
}
