import type { Project } from '@kyvera/shared-types'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ALL_SESSIONS, adminSession, pmoSession } from '../test/fixtures'
import { route, stubApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

const PROTO_PROJECT: Project = {
  id: 'pr-1',
  code: 'PRJ-000001',
  name: 'Solar Lantern Proto',
  productName: 'Solar Lantern',
  productCategory: 'Lighting',
  phase: 'PROTO',
  status: 'ACTIVE',
  protoCompletedAt: null,
  completedAt: null,
  createdById: 'u-pmo',
  createdBy: { id: 'u-pmo', name: 'Priya PMO', email: 'pmo@kyvera.dev', role: 'PMO', createdAt: '2026-09-01T00:00:00.000Z' },
  createdAt: '2026-09-01T00:00:00.000Z',
}

// The new project's own detail page, reached by navigating after a create -
// its own screen is covered by ProjectDetailPage.test.tsx; these routes just
// let that navigation actually land.
const detailRoutes = [
  route('GET', '/projects/pr-1', { body: PROTO_PROJECT }),
  // Anchored to end: `/tech-packs/:id` is a real route too (Screen 3), and
  // must not be intercepted by the *list* endpoint's mock.
  route('GET', /^\/tech-packs$/, { body: [] }),
  route('GET', /^\/proto-requests$/, { body: [] }),
]

describe('GET /projects', () => {
  it('lists projects with code, name, product, phase and status', async () => {
    stubApi([route('GET', '/projects', { body: [PROTO_PROJECT] })])
    renderApp('/projects', { session: adminSession })

    const row = (await screen.findByText('PRJ-000001')).closest('tr')!
    expect(row.textContent).toContain('Solar Lantern Proto')
    expect(row.textContent).toContain('Solar Lantern')
    expect(row.textContent).toContain('Proto')
    expect(row.textContent).toContain('Active')
  })

  it('says so when there are no projects yet', async () => {
    stubApi([route('GET', '/projects', { body: [] })])
    renderApp('/projects', { session: adminSession })

    await screen.findByText('No projects yet.')
  })

  it('surfaces the API error message when the list request fails', async () => {
    stubApi([route('GET', '/projects', { status: 500, body: { error: 'Something broke' } })])
    renderApp('/projects', { session: adminSession })

    expect((await screen.findByRole('alert')).textContent).toBe('Something broke')
  })
})

describe('New project form', () => {
  it.each(['PMO', 'ADMIN'] as const)('is shown to %s', async (role) => {
    const session = role === 'PMO' ? pmoSession : adminSession
    stubApi([route('GET', '/projects', { body: [] })])
    renderApp('/projects', { session })

    await screen.findByText('No projects yet.')
    expect(screen.getByRole('heading', { name: 'New project' })).toBeTruthy()
  })

  // Table-driven over every role except the two that may create a Project, so
  // a role added later can't silently gain this by accident.
  it.each(ALL_SESSIONS.filter((s) => s.user.role !== 'PMO' && s.user.role !== 'ADMIN'))(
    'is not shown to $user.role',
    async (session) => {
      stubApi([route('GET', '/projects', { body: [] })])
      renderApp('/projects', { session })

      await screen.findByText('No projects yet.')
      expect(screen.queryByRole('heading', { name: 'New project' })).toBeNull()
    },
  )

  it('cannot be submitted until name and product are both filled in', async () => {
    stubApi([route('GET', '/projects', { body: [] })])
    renderApp('/projects', { session: pmoSession })
    await screen.findByText('No projects yet.')

    const submit = screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Solar Lantern Proto' } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: '   ' } })
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Solar Lantern' } })
    expect(submit.disabled).toBe(false)
  })

  it('creates the project with the trimmed fields and navigates to its detail page', async () => {
    const api = stubApi([
      route('GET', '/projects', { body: [] }),
      route('POST', '/projects', { status: 201, body: PROTO_PROJECT }),
      ...detailRoutes,
    ])
    renderApp('/projects', { session: pmoSession })
    await screen.findByText('No projects yet.')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Solar Lantern Proto  ' } })
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: '  Solar Lantern  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await screen.findByRole('heading', { name: 'Solar Lantern Proto' })
    expect(screen.getByText('PRJ-000001')).toBeTruthy()
    expect(api.calls.find((c) => c.path === '/projects' && c.method === 'POST')?.body).toEqual({
      name: 'Solar Lantern Proto',
      productName: 'Solar Lantern',
    })
  })

  it('omits productCategory entirely when left blank', async () => {
    const api = stubApi([
      route('GET', '/projects', { body: [] }),
      route('POST', '/projects', { status: 201, body: PROTO_PROJECT }),
      ...detailRoutes,
    ])
    renderApp('/projects', { session: pmoSession })
    await screen.findByText('No projects yet.')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Name' } })
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Product' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await screen.findByRole('heading', { name: 'Solar Lantern Proto' })
    const body = api.calls.find((c) => c.path === '/projects' && c.method === 'POST')?.body
    expect(body).not.toHaveProperty('productCategory')
  })

  it('shows the API error and lets the user try again, without navigating away', async () => {
    stubApi([
      route('GET', '/projects', { body: [] }),
      route('POST', '/projects', { status: 409, body: { error: 'Something went wrong on the server' } }),
    ])
    renderApp('/projects', { session: pmoSession })
    await screen.findByText('No projects yet.')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Name' } })
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Product' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong on the server')
    expect(screen.getByRole('heading', { name: 'New project' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables the submit button and shows a busy label while the request is in flight', async () => {
    stubApi([
      route('GET', '/projects', { body: [] }),
      route('POST', '/projects', { status: 201, body: PROTO_PROJECT }),
      ...detailRoutes,
    ])
    renderApp('/projects', { session: pmoSession })
    await screen.findByText('No projects yet.')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Name' } })
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Product' } })

    // `setSubmitting(true)` runs before the first `await`, so the re-render
    // with the busy label and disabled button is visible synchronously, even
    // though the mocked fetch itself only resolves on a later microtask.
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    const busy = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)

    await screen.findByRole('heading', { name: 'Solar Lantern Proto' }) // let it settle before the next test
  })
})
