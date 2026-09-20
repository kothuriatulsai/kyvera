import type {
  AssigneeDelay,
  AssigneeProductSummary,
  ProductDelay,
  ProductDetail,
  ProductListItem,
  StageDefinition,
  UserSummary,
} from '@kyvera/shared-types'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const owner: UserSummary = {
  id: 'u1',
  name: 'Dana Owner',
  email: 'owner@kyvera.dev',
  role: 'MANAGER',
  createdAt: '2026-09-01T00:00:00.000Z',
}

const stages: StageDefinition[] = [
  { id: 's1', name: 'Requirement', sequenceOrder: 1, expectedDurationDays: 5 },
  { id: 's2', name: 'Initial Design', sequenceOrder: 2, expectedDurationDays: 7 },
]

// Shaped like GET /products: `status` and `delay` are computed live by the server.
function makeProduct(
  id: string,
  name: string,
  overrides: Partial<ProductListItem> = {},
): ProductListItem {
  return {
    id,
    name,
    description: null,
    ownerId: owner.id,
    owner,
    currentStageId: stages[0].id,
    currentStage: stages[0],
    currentVersion: 1,
    view: 'full',
    access: 'ADMIN',
    status: 'ON_TRACK',
    delay: {
      delayed: false,
      totalDelayDays: 0,
      expectedCompletionDate: '2026-11-01T00:00:00.000Z',
    },
    startDate: '2026-09-01T00:00:00.000Z',
    expectedCompletionDate: '2026-11-01T00:00:00.000Z',
    actualCompletionDate: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const onTime = makeProduct('p-ok', 'Steady Widget')
const late = makeProduct('p-late', 'Overdue Gadget', {
  status: 'DELAYED',
  delay: {
    delayed: true,
    totalDelayDays: 4,
    expectedCompletionDate: '2026-11-05T00:00:00.000Z',
  },
})

const delays: Record<string, ProductDelay> = {
  'p-ok': {
    view: 'full',
    expectedCompletionDate: '2026-11-01T00:00:00.000Z',
    totalDelayDays: 0,
    delayed: false,
    stages: [
      { sequenceOrder: 1, status: 'in_progress', durationDays: 5, expectedDurationDays: 5, delayDays: 0, delayed: false },
      { sequenceOrder: 2, status: 'not_started', durationDays: 7, expectedDurationDays: 7, delayDays: 0, delayed: false },
    ],
  },
  'p-late': {
    view: 'full',
    expectedCompletionDate: '2026-11-05T00:00:00.000Z',
    totalDelayDays: 4,
    delayed: true,
    stages: [
      { sequenceOrder: 1, status: 'in_progress', durationDays: 9, expectedDurationDays: 5, delayDays: 4, delayed: true },
      { sequenceOrder: 2, status: 'not_started', durationDays: 7, expectedDurationDays: 7, delayDays: 0, delayed: false },
    ],
  },
}

const lateDetail: ProductDetail = {
  ...late,
  versions: [
    {
      id: 'v1',
      productId: late.id,
      versionNumber: 1,
      spec: 'first spec',
      createdAt: '2026-09-01T00:00:00.000Z',
      createdById: owner.id,
      createdBy: owner,
    },
  ],
  stageHistory: [
    {
      id: 'h1',
      productId: late.id,
      stageId: 's1',
      stage: stages[0],
      enteredAt: '2026-09-01T00:00:00.000Z',
      exitedAt: null,
      actualDurationDays: null,
      delayed: false,
      delayReason: null,
      responsibleUserId: owner.id,
      responsibleUser: owner,
      exitedById: null,
      forcedExit: false,
    },
  ],
  approvals: [],
  assignments: [],
  progressNotes: [],
}

// What someone assigned to only part of a product gets: their own stages, no more.
const assignedEntry: AssigneeProductSummary = {
  view: 'assignee',
  access: 'ASSIGNEE',
  id: 'p-assigned',
  name: 'Assigned Gadget',
  description: null,
  stages: [
    {
      assignmentId: 'a1',
      stage: { id: 's2', name: 'Initial Design', expectedDurationDays: 7 },
      readyAt: null,
      readiness: { state: 'up_next', opensInDays: 3 },
      delay: null,
    },
  ],
}

const assignedDelay: AssigneeDelay = { view: 'assignee', stages: assignedEntry.stages }

function requestedPaths(fetchMock: ReturnType<typeof stubApi>): string[] {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)
}

function stubApi() {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

    if (path === '/products') return json([onTime, late, assignedEntry])
    if (path === '/products/p-assigned') return json({ ...assignedEntry, stages: [{ ...assignedEntry.stages[0], history: [], notes: [] }] })
    if (path === '/products/p-assigned/delay') return json(assignedDelay)
    if (path === '/stages') return json(stages)
    if (path === '/products/p-late') return json(lateDetail)
    const delay = /^\/products\/([^/]+)\/delay$/.exec(path)
    if (delay && delays[delay[1]]) return json(delays[delay[1]])
    return json({ error: 'Product not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('lists products with the status the server computed, in a single request', async () => {
    const fetchMock = stubApi()
    renderAt('/')

    const lateRow = (await screen.findByText('Overdue Gadget')).closest('tr')!
    expect(within(lateRow).getByText('Delayed')).toBeTruthy()

    const okRow = screen.getByText('Steady Widget').closest('tr')!
    expect(within(okRow).getByText('On track')).toBeTruthy()

    // The live status now comes from GET /products; no per-product /delay calls.
    expect(requestedPaths(fetchMock)).toEqual(['/products'])
  })

  it('shows only delayed products on the delayed view, in a single request', async () => {
    const fetchMock = stubApi()
    renderAt('/delayed')

    await screen.findByText('Overdue Gadget')
    expect(screen.getByText('4 days')).toBeTruthy()
    expect(screen.queryByText('Steady Widget')).toBeNull()
    expect(requestedPaths(fetchMock)).toEqual(['/products'])
  })

  it('shows the stage timeline with per-stage delay on the detail view', async () => {
    stubApi()
    renderAt('/products/p-late')

    await screen.findByRole('heading', { name: 'Overdue Gadget' })

    const requirementRow = screen.getAllByText('Requirement')[0].closest('tr')!
    expect(within(requirementRow).getByText('In progress')).toBeTruthy()
    expect(within(requirementRow).getByText('+4 days')).toBeTruthy()

    const designRow = screen.getByText('Initial Design').closest('tr')!
    expect(within(designRow).getByText('Not started')).toBeTruthy()
  })

  it('skips assignee-only entries in the list rather than misrendering them', async () => {
    stubApi()
    renderAt('/')

    await screen.findByText('Overdue Gadget')
    expect(screen.queryByText('Assigned Gadget')).toBeNull()
  })

  it('handles the assignee view on the detail page without crashing', async () => {
    stubApi()
    renderAt('/products/p-assigned')

    const notice = await screen.findByText(/assignee view isn't built yet/i)
    expect(notice).toBeTruthy()
  })

  it('surfaces the API error message when a product is not found', async () => {
    stubApi()
    renderAt('/products/missing')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Product not found')
  })
})
