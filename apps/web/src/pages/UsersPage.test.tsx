import type { UserSummary } from '@kyvera/shared-types'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ALL_SESSIONS, adminSession, financeSession } from '../test/fixtures'
import { route, stubApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

const ADMIN_USER: UserSummary = {
  id: 'u-admin',
  name: 'Alex Admin',
  email: 'admin@kyvera.dev',
  role: 'ADMIN',
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-09-01T00:00:00.000Z',
}

const FINANCE_USER: UserSummary = {
  id: 'u-finance',
  name: 'Fran Finance',
  email: 'finance@kyvera.dev',
  role: 'FINANCE',
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-09-02T00:00:00.000Z',
}

describe('GET /users', () => {
  it('lists users with their role and status', async () => {
    stubApi([route('GET', '/users', { body: [ADMIN_USER, FINANCE_USER] })])
    renderApp('/users', { session: adminSession })

    const row = (await screen.findByText('Fran Finance')).closest('tr')!
    expect(row.textContent).toContain('finance@kyvera.dev')
    expect(row.textContent).toContain('Active')
  })

  it('says so when there are no users yet', async () => {
    stubApi([route('GET', '/users', { body: [] })])
    renderApp('/users', { session: adminSession })

    await screen.findByText('No users yet.')
  })

  it('is not reachable by a non-admin - the route renders as not found, and never calls the API', async () => {
    const api = stubApi([route('GET', '/users', { body: [ADMIN_USER, FINANCE_USER] })])
    renderApp('/users', { session: financeSession })

    await screen.findByText('Page not found.')
    expect(api.calls).toEqual([])
  })
})

describe('New user form', () => {
  it('creates a user with no password field, reveals the generated one, and the list reflects it', async () => {
    let users: UserSummary[] = [ADMIN_USER]
    const api = stubApi([
      { method: 'GET', path: '/users', respond: () => ({ body: users }) },
      {
        method: 'POST',
        path: '/users',
        respond: (request) => {
          const body = request.body as { name: string; email: string; role: UserSummary['role'] }
          const created: UserSummary = {
            id: 'u-new',
            name: body.name,
            email: body.email,
            role: body.role,
            isActive: true,
            mustChangePassword: true,
            createdAt: '2026-10-07T00:00:00.000Z',
          }
          users = [...users, created]
          return { status: 201, body: { user: created, temporaryPassword: 'generated-xyz789' } }
        },
      },
    ])
    renderApp('/users', { session: adminSession })
    await screen.findByText('Alex Admin')

    expect(screen.queryByLabelText(/temporary password/i)).toBeNull()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Person' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@kyvera.dev' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }))

    await screen.findByText('New Person') // the table row
    await screen.findByText('generated-xyz789') // the one-time reveal
    expect(api.calls.find((c) => c.path === '/users' && c.method === 'POST')?.body).toEqual({
      name: 'New Person',
      email: 'new@kyvera.dev',
      role: 'FINANCE',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('generated-xyz789')).toBeNull()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('') // back to a fresh form
  })
})

describe('Role control', () => {
  it('requires an explicit Change + Confirm, and does nothing on select alone', async () => {
    let users: UserSummary[] = [ADMIN_USER, FINANCE_USER]
    const api = stubApi([
      { method: 'GET', path: '/users', respond: () => ({ body: users }) },
      {
        method: 'PATCH',
        path: '/users/u-finance/role',
        respond: (request) => {
          const { role } = request.body as { role: UserSummary['role'] }
          users = users.map((u) => (u.id === 'u-finance' ? { ...u, role } : u))
          return { body: users.find((u) => u.id === 'u-finance') }
        },
      },
    ])
    renderApp('/users', { session: adminSession })
    const row = (await screen.findByText('Fran Finance')).closest('tr')!
    const select = within(row).getByRole('combobox') as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'MANAGEMENT' } })
    // Selecting alone must not submit anything.
    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false)

    fireEvent.click(within(row).getByRole('button', { name: 'Change' }))
    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false) // still waiting on the confirm
    expect(row.textContent).toMatch(/Change Fran Finance.s role to MANAGEMENT\?/)

    fireEvent.click(within(row).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(select.value).toBe('MANAGEMENT'))
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ role: 'MANAGEMENT' })
  })

  it('cancelling leaves the role unchanged and sends no request', async () => {
    const api = stubApi([route('GET', '/users', { body: [ADMIN_USER, FINANCE_USER] })])
    renderApp('/users', { session: adminSession })
    const row = (await screen.findByText('Fran Finance')).closest('tr')!
    const select = within(row).getByRole('combobox') as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'MANAGEMENT' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Change' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }))

    expect(select.value).toBe('FINANCE')
    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })
})

describe('Deactivate / reactivate controls', () => {
  it('deactivates then reactivates a user', async () => {
    let user = FINANCE_USER
    stubApi([
      { method: 'GET', path: '/users', respond: () => ({ body: [user] }) },
      {
        method: 'POST',
        path: '/users/u-finance/deactivate',
        respond: () => {
          user = { ...user, isActive: false }
          return { body: user }
        },
      },
      {
        method: 'POST',
        path: '/users/u-finance/reactivate',
        respond: () => {
          user = { ...user, isActive: true }
          return { body: user }
        },
      },
    ])
    renderApp('/users', { session: adminSession })
    await screen.findByText('Fran Finance')
    expect(screen.getByText('Active')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))

    await screen.findByText('Inactive')
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }))

    await screen.findByText('Active')
  })
})

describe('Reset password control', () => {
  it('reveals the generated temporary password, with no password input to fill in', async () => {
    const api = stubApi([
      route('GET', '/users', { body: [FINANCE_USER] }),
      route('POST', '/users/u-finance/reset-password', {
        body: { user: { ...FINANCE_USER, mustChangePassword: true }, temporaryPassword: 'generated-abc123' },
      }),
    ])
    renderApp('/users', { session: adminSession })
    await screen.findByText('Fran Finance')

    expect(screen.queryByLabelText(/new password/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    await screen.findByText('generated-abc123')
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '/users/u-finance/reset-password')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('generated-abc123')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeTruthy()
  })
})

describe('Users nav link', () => {
  it('is shown to ADMIN', async () => {
    stubApi([route('GET', '/projects', { body: [] })])
    renderApp('/projects', { session: adminSession })

    await screen.findByText('No projects yet.')
    expect(screen.getByRole('link', { name: 'Users' })).toBeTruthy()
  })

  it.each(ALL_SESSIONS.filter((s) => s.user.role !== 'ADMIN'))('is not shown to $user.role', async (session) => {
    stubApi([route('GET', '/projects', { body: [] })])
    renderApp('/projects', { session })

    await screen.findByText('No projects yet.')
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull()
  })
})
