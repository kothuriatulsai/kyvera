import type {
  ProductDelay,
  ProductDetail,
  ProductStageHistoryEntry,
  StageAssignment,
  StageProgress,
} from '@kyvera/shared-types'
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  adminSession,
  engineerUser,
  lateDetail,
  ownerUser,
  stages,
} from '../test/fixtures'
import { route, stubApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

const PRODUCT = '/products/p-x'
const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}T00:00:00.000Z`

function person(id: string, name: string) {
  return { ...engineerUser, id, name }
}

// [stage order, entered day, exited day or null]; each visit becomes a history row.
function historyOf(
  visits: [number, number, number | null][],
  responsible: Record<number, typeof ownerUser | null> = {},
): ProductStageHistoryEntry[] {
  return visits
    .map(([order, entered, exited], i): ProductStageHistoryEntry => ({
      id: `h${i}`,
      productId: 'p-x',
      stageId: stages[order - 1].id,
      stage: stages[order - 1],
      enteredAt: day(entered),
      exitedAt: exited === null ? null : day(exited),
      actualDurationDays: exited === null ? null : exited - entered,
      delayed: false,
      delayReason: null,
      responsibleUserId: responsible[order]?.id ?? null,
      responsibleUser: responsible[order] ?? null,
      exitedById: null,
      forcedExit: false,
    }))
    .reverse() // the API returns newest first
}

function assignmentOn(order: number, who: ReturnType<typeof person>): StageAssignment {
  return {
    ...lateDetail.assignments[0],
    id: `a-${who.id}-${order}`,
    productId: 'p-x',
    stageId: stages[order - 1].id,
    stage: stages[order - 1],
    userId: who.id,
    user: who,
    readyAt: null,
  }
}

function delayWith(statuses: StageProgress[]): ProductDelay {
  return {
    ...lateDetail.delay,
    view: 'full',
    delayed: false,
    totalDelayDays: 0,
    expectedCompletionDate: day(30),
    stages: stages.map((s, i) => ({
      sequenceOrder: s.sequenceOrder,
      status: statuses[i] ?? 'not_started',
      durationDays: s.expectedDurationDays,
      expectedDurationDays: s.expectedDurationDays,
      delayDays: 0,
      delayed: false,
    })),
  }
}

async function open(detail: ProductDetail, delay: ProductDelay) {
  stubApi([
    route('GET', PRODUCT, { body: detail }),
    route('GET', `${PRODUCT}/delay`, { body: delay }),
    route('GET', '/stages', { body: stages }),
  ])
  renderApp(PRODUCT, { session: adminSession })
  await screen.findByRole('heading', { name: 'Timeline' })
}

const tableAfter = (heading: string) =>
  screen.getByRole('heading', { name: heading }).nextElementSibling as HTMLElement
const bodyRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1)
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent)

const ann = person('u-ann', 'Ann Assignee')
const bob = person('u-bob', 'Bob Builder')
const cy = person('u-cy', 'Cy Checker')

// A product that went 1 -> 2 -> 3 and was then sent back from 3 to 2.
const movedBackOnce: ProductDetail = {
  ...lateDetail,
  id: 'p-x',
  name: 'Widget X',
  currentStageId: stages[1].id,
  currentStage: stages[1],
  progressNotes: [],
  assignments: [assignmentOn(3, ann), assignmentOn(3, bob), assignmentOn(2, cy)],
  stageHistory: historyOf(
    [
      [1, 1, 5],
      [2, 5, 9],
      [3, 9, 11],
      [2, 11, null],
    ],
    { 1: ownerUser },
  ),
}

describe('a product that has been moved back', () => {
  it('does not call the stage it was sent back from "Completed" in the timeline', async () => {
    await open(movedBackOnce, delayWith(['completed', 'in_progress', 'sent_back']))

    const rows = bodyRows(tableAfter('Timeline'))
    const progressOf = (stage: string) =>
      cells(rows.find((r) => within(r).queryByText(stage))!)[2]

    expect(progressOf('Requirement')).toBe('Completed')
    expect(progressOf('Initial Design')).toBe('In progress') // where it is now
    expect(progressOf('Engineering')).toBe('Sent back') // where it was sent back from
    expect(progressOf('Review')).toBe('Not started') // never reached
  })

  it('labels every stage it was sent back past when moved back more than once', async () => {
    const movedBackTwice: ProductDetail = {
      ...movedBackOnce,
      currentStageId: stages[0].id,
      currentStage: stages[0],
      stageHistory: historyOf([
        [1, 1, 5],
        [2, 5, 9],
        [3, 9, 11],
        [2, 11, 13],
        [1, 13, null],
      ]),
    }
    await open(movedBackTwice, delayWith(['in_progress', 'sent_back', 'sent_back']))

    const timeline = tableAfter('Timeline')
    const progress = bodyRows(timeline).slice(0, 4).map((r) => cells(r)[2])
    expect(progress).toEqual(['In progress', 'Sent back', 'Sent back', 'Not started'])
    // Nothing in the timeline is "Completed": the product is back at the start.
    expect(within(timeline).queryByText('Completed')).toBeNull()
  })

  it('says how each stage-history entry ended: current, completed or sent back', async () => {
    await open(movedBackOnce, delayWith(['completed', 'in_progress', 'sent_back']))

    const rows = bodyRows(tableAfter('Stage history'))
    // Newest first: [Initial Design (now)], [Engineering], [Initial Design], [Requirement].
    expect(rows.map((r) => [cells(r)[0], cells(r)[3]])).toEqual([
      ['Initial Design', 'Current'],
      ['Engineering', 'Sent back'],
      ['Initial Design', 'Completed'],
      ['Requirement', 'Completed'],
    ])
  })

  it('shows every assignee of the stage, behind a "Multiple" icon when there are several', async () => {
    await open(movedBackOnce, delayWith(['completed', 'in_progress', 'sent_back']))

    const rows = bodyRows(tableAfter('Stage history'))
    const responsible = rows.map((r) => cells(r)[4])

    expect(responsible[0]).toBe('Cy Checker') // Initial Design: one assignee
    expect(responsible[1]).toContain('Multiple') // Engineering: Ann and Bob
    expect(responsible[2]).toBe('Cy Checker') // an earlier visit to the same stage
    expect(responsible[3]).toBe('Dana Owner') // Requirement: nobody assigned, so who was recorded

    // Ann and Bob aren't listed in the history until the icon is pressed. (They do
    // appear in the separate Assignments table, so look only at the history.)
    expect(within(tableAfter('Stage history')).queryByText('Ann Assignee')).toBeNull()
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Show all 2 assignees of Engineering' }))

    const popover = screen.getByRole('dialog', { name: 'Assignees of Engineering' })
    expect(within(popover).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Ann Assignee',
      'Bob Builder',
    ])
  })

  it('has no popover icon on a stage with a single assignee', async () => {
    await open(movedBackOnce, delayWith(['completed', 'in_progress', 'sent_back']))

    const rows = bodyRows(tableAfter('Stage history'))
    expect(within(rows[0]).queryByRole('button')).toBeNull()
    expect(within(rows[3]).queryByRole('button')).toBeNull()
  })
})
