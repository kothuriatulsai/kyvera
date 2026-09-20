import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ALL_STAGE_NAMES,
  assigneeDetail,
  assigneeSummary,
  engineerSession,
  lateProduct,
} from './fixtures'
import { route, stubApi, type MockRoute } from './mockApi'
import { renderApp } from './renderApp'

const PRODUCT = '/products/p-assigned'

/** Everything the assignee view is allowed to show, and nothing it withholds. */
const WITHHELD_LABELS = [
  'Owner',
  'Status',
  'Projected completion',
  'Timeline',
  'Versions',
  'Stage history',
  'Total delay',
  'Assignments',
]

function pageText() {
  return document.body.textContent ?? ''
}

describe('the assignee view: list', () => {
  it('shows only their own stage and when it happens', async () => {
    const api = stubApi([
      route('GET', '/products', {
        body: [
          assigneeSummary({
            readiness: { state: 'up_next', opensInDays: 5 },
            delay: { durationDays: 9, expectedDurationDays: 7, delayDays: 2, delayed: true },
          }),
        ],
      }),
    ])
    renderApp('/', { session: engineerSession })

    const row = (await screen.findByText('Assigned Gadget')).closest('tr')!
    expect(within(row).getByText('Initial Design')).toBeTruthy()
    expect(within(row).getByText("You're up next: opens in ~5 days")).toBeTruthy()
    expect(within(row).getByText('+2 days')).toBeTruthy()

    // No full-view table, and none of what it would have shown.
    expect(screen.queryByRole('columnheader', { name: 'Owner' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Assigned to you' })).toBeTruthy()
    // One request: it did not go looking for the rest of the workflow.
    expect(api.paths()).toEqual(['/products'])
  })

  it('shows both kinds of entry to someone who is an owner of one product and an assignee on another', async () => {
    stubApi([route('GET', '/products', { body: [lateProduct, assigneeSummary()] })])
    renderApp('/', { session: engineerSession })

    await screen.findByText('Overdue Gadget')
    expect(screen.getByText('Assigned Gadget')).toBeTruthy()
    // The owner column belongs to the full table only.
    expect(screen.getAllByRole('columnheader', { name: 'Owner' })).toHaveLength(1)
  })

  it('lists, on the delayed page, only the stages of theirs that are running late', async () => {
    stubApi([
      route('GET', '/products', {
        body: [
          assigneeSummary({
            delay: { durationDays: 9, expectedDurationDays: 7, delayDays: 2, delayed: true },
          }),
          { ...assigneeSummary(), id: 'p-fine', name: 'On Time Gadget' },
        ],
      }),
    ])
    renderApp('/delayed', { session: engineerSession })

    await screen.findByText('Assigned Gadget')
    expect(screen.getByRole('heading', { name: 'Your stages running late' })).toBeTruthy()
    expect(screen.queryByText('On Time Gadget')).toBeNull()
  })

  it('says nothing is delayed when none of their stages are', async () => {
    stubApi([route('GET', '/products', { body: [assigneeSummary()] })])
    renderApp('/delayed', { session: engineerSession })

    await screen.findByText('Nothing is delayed right now.')
  })
})

describe('the assignee view: detail', () => {
  it('never renders, or even requests, anything outside their own stage', async () => {
    const api = stubApi([
      route('GET', PRODUCT, {
        body: assigneeDetail(
          { readiness: { state: 'open_now', opensInDays: null } },
          { description: 'A small gadget' },
        ),
      }),
      // If the frontend went looking for the wider workflow, these would answer -
      // and the assertions below would catch it having asked.
      route('GET', '/stages', { body: [] }),
      route('GET', `${PRODUCT}/delay`, { body: {} }),
    ])
    renderApp(PRODUCT, { session: engineerSession })

    await screen.findByRole('heading', { name: 'Assigned Gadget' })

    // Only the requests the assignee view needs.
    expect(api.paths()).toEqual([PRODUCT])

    // Their own stage is there...
    expect(screen.getByRole('heading', { name: 'Initial Design' })).toBeTruthy()
    // ...and no other stage name appears anywhere on the page.
    const text = pageText()
    for (const name of ALL_STAGE_NAMES.filter((n) => n !== 'Initial Design')) {
      expect(text, `must not show "${name}"`).not.toContain(name)
    }
    for (const label of WITHHELD_LABELS) {
      expect(text, `must not show "${label}"`).not.toContain(label)
    }
    expect(screen.queryByText(/v1\b/)).toBeNull()
  })

  it('shows only what the server sent: no invented delay, history or notes', async () => {
    stubApi([route('GET', PRODUCT, { body: assigneeDetail() })])
    renderApp(PRODUCT, { session: engineerSession })

    await screen.findByRole('heading', { name: 'Initial Design' })

    expect(screen.queryByText('Running late')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'History' })).toBeNull()
    expect(screen.getByText('No notes yet.')).toBeTruthy()
  })

  it('shows the delay, history and notes the server did send', async () => {
    stubApi([
      route('GET', PRODUCT, {
        body: assigneeDetail({
          delay: { durationDays: 9, expectedDurationDays: 7, delayDays: 2, delayed: true },
          history: [
            {
              enteredAt: '2026-09-01T00:00:00.000Z',
              exitedAt: null,
              actualDurationDays: null,
              delayed: false,
              delayReason: 'Waiting on the supplier',
            },
          ],
          notes: [
            { id: 'n1', note: 'Mine: half done', createdAt: '2026-09-02T00:00:00.000Z', isMine: true },
            { id: 'n2', note: 'A colleague’s note', createdAt: '2026-09-03T00:00:00.000Z', isMine: false },
          ],
        }),
      }),
    ])
    renderApp(PRODUCT, { session: engineerSession })

    await screen.findByRole('heading', { name: 'Initial Design' })

    expect(screen.getByText('+2 days')).toBeTruthy()
    expect(screen.getByText('Waiting on the supplier')).toBeTruthy()
    const mine = screen.getByText('Mine: half done').closest('li')!
    expect(mine.textContent).toContain('you')
    // A colleague's note carries no author: the API doesn't name them, so neither do we.
    const theirs = screen.getByText('A colleague’s note').closest('li')!
    expect(theirs.textContent).not.toContain('you')
  })

  it('handles two assigned stages, each with its own actions', async () => {
    const first = assigneeDetail()
    const both = {
      ...first,
      stages: [
        first.stages[0],
        {
          ...first.stages[0],
          assignmentId: 'a2',
          stage: { id: 's4', name: 'Review', expectedDurationDays: 3 },
          readiness: { state: 'upcoming' as const, opensInDays: 12 },
        },
      ],
    }
    stubApi([route('GET', PRODUCT, { body: both })])
    renderApp(PRODUCT, { session: engineerSession })

    await screen.findByRole('heading', { name: 'Initial Design' })
    expect(screen.getByRole('heading', { name: 'Review' })).toBeTruthy()
    expect(screen.getByText('Opens in ~12 days')).toBeTruthy()
    // Only the open stage offers to be completed.
    expect(screen.getAllByRole('button', { name: 'Complete this stage' })).toHaveLength(1)
  })
})

/** A detail endpoint whose stage state can be changed by what the test does. */
function statefulDetail(initial = assigneeDetail()) {
  let current = initial
  const routes: MockRoute[] = [
    { method: 'GET', path: PRODUCT, respond: () => ({ body: current }) },
  ]
  return {
    routes,
    set: (next: typeof current) => {
      current = next
    },
  }
}

describe('the assignee view: actions', () => {
  it('offers "mark ready" only while the stage is open, and records it', async () => {
    const detail = statefulDetail()
    const api = stubApi([
      ...detail.routes,
      {
        method: 'POST',
        path: `${PRODUCT}/assignments/a1/ready`,
        respond: () => {
          detail.set(assigneeDetail({ readyAt: '2026-09-05T00:00:00.000Z' }))
          return { body: { assignmentId: 'a1', stageId: 's2', readyAt: '2026-09-05T00:00:00.000Z' } }
        },
      },
    ])
    renderApp(PRODUCT, { session: engineerSession })

    fireEvent.click(await screen.findByRole('button', { name: 'Mark my part ready' }))

    await screen.findByText(/You marked your part ready on/)
    expect(api.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      `${PRODUCT}/assignments/a1/ready`,
    ])
    // Marking ready is its own action: it must not advance the product.
    expect(api.calls.some((c) => c.path.endsWith('/transition'))).toBe(false)
    expect(screen.queryByRole('button', { name: 'Mark my part ready' })).toBeNull()
  })

  it.each([
    ['not open yet', { readiness: { state: 'upcoming' as const, opensInDays: 9 } }],
    ['already completed', { readiness: { state: 'completed' as const, opensInDays: null } }],
  ])('offers neither "mark ready" nor "complete" for a stage that is %s', async (_label, stage) => {
    stubApi([route('GET', PRODUCT, { body: assigneeDetail(stage) })])
    renderApp(PRODUCT, { session: engineerSession })

    await screen.findByRole('heading', { name: 'Initial Design' })

    expect(screen.queryByRole('button', { name: 'Mark my part ready' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Complete this stage' })).toBeNull()
    // A note can still be added at any time.
    expect(screen.getByLabelText('Add a note on this stage')).toBeTruthy()
  })

  it('adds a progress note at any time, then shows it and clears the box', async () => {
    const detail = statefulDetail(
      assigneeDetail({ readiness: { state: 'upcoming', opensInDays: 9 } }),
    )
    const api = stubApi([
      ...detail.routes,
      {
        method: 'POST',
        path: `${PRODUCT}/stages/s2/notes`,
        respond: () => {
          detail.set(
            assigneeDetail({
              readiness: { state: 'upcoming', opensInDays: 9 },
              notes: [{ id: 'n9', note: 'Sourcing parts early', createdAt: '2026-09-06T00:00:00.000Z', isMine: true }],
            }),
          )
          return { status: 201, body: { id: 'n9', stageId: 's2', note: 'Sourcing parts early', createdAt: '2026-09-06T00:00:00.000Z' } }
        },
      },
    ])
    renderApp(PRODUCT, { session: engineerSession })

    const box = await screen.findByLabelText('Add a note on this stage')
    const submit = screen.getByRole('button', { name: 'Add note' })
    expect((submit as HTMLButtonElement).disabled).toBe(true) // nothing to send yet
    fireEvent.change(box, { target: { value: 'Sourcing parts early' } })
    fireEvent.click(submit)

    await screen.findByText('Sourcing parts early')
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ note: 'Sourcing parts early' })
    expect((box as HTMLTextAreaElement).value).toBe('')
    expect(api.calls.some((c) => c.path.endsWith('/transition'))).toBe(false)
  })

  it('completes the stage and shows the result', async () => {
    const detail = statefulDetail()
    const api = stubApi([
      ...detail.routes,
      {
        method: 'POST',
        path: `${PRODUCT}/transition`,
        respond: () => {
          detail.set(assigneeDetail({ readiness: { state: 'completed', opensInDays: null } }))
          return { body: assigneeDetail({ readiness: { state: 'completed', opensInDays: null } }) }
        },
      },
    ])
    renderApp(PRODUCT, { session: engineerSession })

    fireEvent.click(await screen.findByRole('button', { name: 'Complete this stage' }))

    await screen.findByText('Completed')
    expect(api.calls.find((c) => c.path === `${PRODUCT}/transition`)?.body).toEqual({})
    expect(screen.queryByRole('button', { name: 'Complete this stage' })).toBeNull()
  })

  it("shows the server's own reason when it refuses, and changes nothing", async () => {
    // The API doesn't say how many people share a stage, so the UI can't know in
    // advance whether "complete" will be allowed. It offers it, and reports honestly.
    const reason =
      "This stage has several assignees: mark yourself ready, and an admin, the product's owner or an assigned manager advances it"
    stubApi([
      route('GET', PRODUCT, { body: assigneeDetail() }),
      route('POST', `${PRODUCT}/transition`, { status: 403, body: { error: reason } }),
    ])
    renderApp(PRODUCT, { session: engineerSession })

    fireEvent.click(await screen.findByRole('button', { name: 'Complete this stage' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(reason)
    expect(screen.getByText('Open now')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Complete this stage' })).toBeTruthy()
  })

  it('shows the server’s reason when a note is refused', async () => {
    stubApi([
      route('GET', PRODUCT, { body: assigneeDetail() }),
      route('POST', `${PRODUCT}/stages/s2/notes`, {
        status: 400,
        body: { error: 'note must be at most 2000 characters' },
      }),
    ])
    renderApp(PRODUCT, { session: engineerSession })

    fireEvent.change(await screen.findByLabelText('Add a note on this stage'), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))

    expect((await screen.findByRole('alert')).textContent).toBe('note must be at most 2000 characters')
  })
})
