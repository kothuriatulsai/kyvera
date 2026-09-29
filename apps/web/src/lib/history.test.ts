import { describe, expect, it } from 'vitest'
import { historyOutcomes } from './history'

// A visit to `order`, entered on day `entered`, left on day `exited` (null = still there).
function visit(id: string, order: number, entered: number, exited: number | null) {
  const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}T00:00:00.000Z`
  return {
    id,
    stage: { sequenceOrder: order },
    enteredAt: day(entered),
    exitedAt: exited === null ? null : day(exited),
  }
}

describe('historyOutcomes', () => {
  it('calls the visit the product is in now "current"', () => {
    const outcomes = historyOutcomes([visit('a', 1, 1, null)])
    expect(outcomes.get('a')).toBe('current')
  })

  it('calls a visit that led to a later stage "completed"', () => {
    const outcomes = historyOutcomes([visit('a', 1, 1, 3), visit('b', 2, 3, null)])
    expect(outcomes.get('a')).toBe('completed')
    expect(outcomes.get('b')).toBe('current')
  })

  it('calls a visit that led back to an earlier stage "sent back"', () => {
    // 1 -> 2 -> 3, then back to 2.
    const outcomes = historyOutcomes([
      visit('a', 1, 1, 3),
      visit('b', 2, 3, 5),
      visit('c', 3, 5, 7),
      visit('d', 2, 7, null),
    ])
    expect(outcomes.get('c')).toBe('sent_back')
    expect(outcomes.get('a')).toBe('completed')
    expect(outcomes.get('b')).toBe('completed')
    expect(outcomes.get('d')).toBe('current')
  })

  it('gets it right when moved back more than once', () => {
    // 1 -> 2 -> 3, back to 2, back again to 1.
    const outcomes = historyOutcomes([
      visit('a', 1, 1, 3),
      visit('b', 2, 3, 5),
      visit('c', 3, 5, 7),
      visit('d', 2, 7, 9),
      visit('e', 1, 9, null),
    ])
    expect(outcomes.get('c')).toBe('sent_back') // 3 -> 2
    expect(outcomes.get('d')).toBe('sent_back') // 2 -> 1
    expect(outcomes.get('e')).toBe('current')
  })

  it('judges each visit by what happened next, so a stage can be both', () => {
    // Stage 2 was completed once, then sent back once.
    const outcomes = historyOutcomes([
      visit('a', 1, 1, 3),
      visit('b', 2, 3, 5), // -> 3: completed
      visit('c', 3, 5, 7),
      visit('d', 2, 7, 9), // -> 1: sent back
      visit('e', 1, 9, null),
    ])
    expect(outcomes.get('b')).toBe('completed')
    expect(outcomes.get('d')).toBe('sent_back')
  })

  it('does not depend on the order the entries arrive in (the API sends newest first)', () => {
    const chronological = [visit('a', 1, 1, 3), visit('b', 2, 3, 5), visit('c', 1, 5, null)]
    const newestFirst = [...chronological].reverse()

    expect([...historyOutcomes(newestFirst)]).toEqual(
      expect.arrayContaining([...historyOutcomes(chronological)]),
    )
    expect(historyOutcomes(newestFirst).get('b')).toBe('sent_back')
  })

  it('treats a closed visit with nothing after it as completed', () => {
    expect(historyOutcomes([visit('a', 1, 1, 3)]).get('a')).toBe('completed')
  })
})
