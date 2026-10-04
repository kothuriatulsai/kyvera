import type { TechPackListItem } from '@kyvera/shared-types'

/**
 * Non-voided first - the API allows at most one active TechPack per Project
 * per phase (see sopPermissions.canCreateTechPack), so this never has to pick
 * among several - then newest first within each group.
 */
export function sortTechPacks(techPacks: TechPackListItem[]): TechPackListItem[] {
  return [...techPacks].sort((a, b) => {
    if ((a.voidedAt === null) !== (b.voidedAt === null)) {
      return a.voidedAt === null ? -1 : 1
    }
    return b.createdAt.localeCompare(a.createdAt)
  })
}

/**
 * The TechPack that replaced `techPack`, if Management rejected it. Found by
 * matching `supersedesId` within the same list, since `GET /tech-packs`
 * doesn't expand that relation (see shared-types' `TechPackListItem`) - only
 * `GET /tech-packs/:id` does, as `supersededBy`.
 */
export function successorOf(
  techPack: TechPackListItem,
  techPacks: TechPackListItem[],
): TechPackListItem | undefined {
  return techPacks.find((tp) => tp.supersedesId === techPack.id)
}
