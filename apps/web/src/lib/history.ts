import type { ProductStageHistoryEntry } from '@kyvera/shared-types'

export type HistoryOutcome = 'current' | 'completed' | 'sent_back'

type HistoryRow = Pick<ProductStageHistoryEntry, 'id' | 'enteredAt' | 'exitedAt'> & {
  stage: Pick<ProductStageHistoryEntry['stage'], 'sequenceOrder'>
}

/**
 * How each visit to a stage ended. A visit that has an exit date was not
 * necessarily finished: the product may have been moved *backward* out of it. The
 * direction is whatever the product did next - if its next visit was to an earlier
 * stage, it was sent back; to a later one, it was completed.
 *
 * The history is returned newest first, so this sorts it into the order things
 * actually happened before comparing each visit with the one that followed it.
 */
export function historyOutcomes(entries: HistoryRow[]): Map<string, HistoryOutcome> {
  const inOrder = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.enteredAt.localeCompare(b.entry.enteredAt) || a.index - b.index)
    .map(({ entry }) => entry)

  const outcomes = new Map<string, HistoryOutcome>()
  inOrder.forEach((entry, i) => {
    if (entry.exitedAt === null) {
      outcomes.set(entry.id, 'current')
      return
    }
    const next = inOrder[i + 1]
    outcomes.set(
      entry.id,
      next && next.stage.sequenceOrder < entry.stage.sequenceOrder ? 'sent_back' : 'completed',
    )
  })
  return outcomes
}

export const OUTCOME_LABELS: Record<HistoryOutcome, string> = {
  current: 'Current',
  completed: 'Completed',
  sent_back: 'Sent back',
}
