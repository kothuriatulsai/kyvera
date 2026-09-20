import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  adminSession,
  assigneeSummary,
  lateDelay,
  lateDetail,
  lateProduct,
  onTimeProduct,
  stages,
} from './test/fixtures'
import { route, stubApi } from './test/mockApi'
import { renderApp } from './test/renderApp'

// The views an admin (or an owner / assigned manager) sees. Logged in through the
// session seam here; the login flow itself is covered in auth.test.tsx.
function stubFullApi(extra: Parameters<typeof stubApi>[0] = []) {
  // `extra` goes first: the first matching route wins, so it can override a default.
  return stubApi([
    ...extra,
    route('GET', '/products', { body: [onTimeProduct, lateProduct] }),
    route('GET', '/stages', { body: stages }),
    route('GET', '/products/p-late', { body: lateDetail }),
    route('GET', '/products/p-late/delay', { body: lateDelay }),
  ])
}

describe('full views (admin, owner, assigned manager)', () => {
  it('lists products with the status the server computed, in a single request', async () => {
    const api = stubFullApi()
    renderApp('/', { session: adminSession })

    const lateRow = (await screen.findByText('Overdue Gadget')).closest('tr')!
    expect(within(lateRow).getByText('Delayed')).toBeTruthy()
    const okRow = screen.getByText('Steady Widget').closest('tr')!
    expect(within(okRow).getByText('On track')).toBeTruthy()

    // The live status comes from GET /products; no per-product /delay calls.
    expect(api.paths()).toEqual(['/products'])
  })

  it('shows only delayed products on the delayed view, in a single request', async () => {
    const api = stubFullApi()
    renderApp('/delayed', { session: adminSession })

    await screen.findByText('Overdue Gadget')
    expect(screen.getByText('4 days')).toBeTruthy()
    expect(screen.queryByText('Steady Widget')).toBeNull()
    expect(api.paths()).toEqual(['/products'])
  })

  it('shows the stage timeline with per-stage delay on the detail view', async () => {
    stubFullApi()
    renderApp('/products/p-late', { session: adminSession })

    await screen.findByRole('heading', { name: 'Overdue Gadget' })

    const requirementRow = screen.getAllByText('Requirement')[0].closest('tr')!
    expect(within(requirementRow).getByText('In progress')).toBeTruthy()
    expect(within(requirementRow).getByText('+4 days')).toBeTruthy()
    const designRow = screen.getAllByText('Initial Design')[0].closest('tr')!
    expect(within(designRow).getByText('Not started')).toBeTruthy()
  })

  it('shows who is assigned to what, and the notes they left, to someone who sees it all', async () => {
    stubFullApi()
    renderApp('/products/p-late', { session: adminSession })

    await screen.findByRole('heading', { name: 'Overdue Gadget' })

    const assignments = screen.getByRole('heading', { name: 'Assignments' }).nextElementSibling!
    expect(within(assignments as HTMLElement).getByText('Eli Engineer')).toBeTruthy()
    expect(screen.getByText('Waiting on the housing supplier')).toBeTruthy()
  })

  it('carries the logged-in user’s token on every request', async () => {
    const api = stubFullApi()
    renderApp('/', { session: adminSession })

    await screen.findByText('Overdue Gadget')

    expect(api.calls.length).toBeGreaterThan(0)
    for (const call of api.calls) expect(call.authorization).toBe('Bearer tok-admin')
  })

  it('renders a full view and an assignee view together for someone who is both', async () => {
    stubFullApi([
      route('GET', '/products', { body: [lateProduct, assigneeSummary()] }),
    ])
    renderApp('/', { session: adminSession })

    await screen.findByText('Overdue Gadget')
    expect(screen.getByRole('heading', { name: 'Assigned to you' })).toBeTruthy()
    expect(screen.getByText('Assigned Gadget')).toBeTruthy()
  })

  it('surfaces the API error message when a product is not found', async () => {
    stubApi([route('GET', /^\/products\/missing/, { status: 404, body: { error: 'Product not found' } })])
    renderApp('/products/missing', { session: adminSession })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Product not found')
  })
})
