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
  createdAt: '2026-09-01T00:00:00.000Z',
}

const FINANCE_USER: UserSummary = {
  id: 'u-finance',
  name: 'Fran Finance',
  email: 'finance@kyvera.dev',
  role: 'FINANCE',
  isActive: true,
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

  it('surfaces the API error for a non-admin instead of showing the table', async () => {
    stubApi([
      route('GET', '/users', {
        status: 403,
        body: { error: 'This action requires one of these roles: ADMIN' },
      }),
    ])
    renderApp('/users', { session: financeSession })

    expect((await screen.findByRole('alert')).textContent).toMatch(/requires one of these roles/i)
  })
})

describe('New user form', () => {
  it('creates a user and the list reflects it', async () => {
    let users: UserSummary[] = [ADMIN_USER]
    const api = stubApi([
      { method: 'GET', path: '/users', respond: () => ({ body: users }) },
      {
        method: 'POST',
        path: '/users',
        respond: (request) => {
          const body = request.body as {
            name: string
            email: string
            role: UserSummary['role']
            temporaryPassword: string
          }
          const created: UserSummary = {
            id: 'u-new',
            name: body.name,
            email: body.email,
            role: body.role,
            isActive: true,
            createdAt: '2026-10-07T00:00:00.000Z',
          }
          users = [...users, created]
          return { status: 201, body: created }
        },
      },
    ])
    renderApp('/users', { session: adminSession })
    await screen.findByText('Alex Admin')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Person' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@kyvera.dev' } })
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'a-temp-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }))

    await screen.findByText('New Person')
    expect(api.calls.find((c) => c.path === '/users' && c.method === 'POST')?.body).toMatchObject({
      name: 'New Person',
      email: 'new@kyvera.dev',
      role: 'FINANCE',
      temporaryPassword: 'a-temp-password',
    })
  })
})

describe('Role control', () => {
  it("changes a user's role", async () => {
    let users: UserSummary[] = [ADMIN_USER, FINANCE_USER]
    stubApi([
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

    await waitFor(() => expect(select.value).toBe('MANAGEMENT'))
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
  it('sets a new password and hides the field again', async () => {
    const api = stubApi([
      route('GET', '/users', { body: [FINANCE_USER] }),
      route('POST', '/users/u-finance/reset-password', { body: FINANCE_USER }),
    ])
    renderApp('/users', { session: adminSession })
    await screen.findByText('Fran Finance')

    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    fireEvent.change(screen.getByLabelText('New password for Fran Finance'), {
      target: { value: 'a-new-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))

    await waitFor(() => expect(screen.queryByLabelText('New password for Fran Finance')).toBeNull())
    expect(
      api.calls.find((c) => c.method === 'POST' && c.path === '/users/u-finance/reset-password')?.body,
    ).toEqual({ password: 'a-new-password' })
  })

  it('can be cancelled without sending a request', async () => {
    const api = stubApi([route('GET', '/users', { body: [FINANCE_USER] })])
    renderApp('/users', { session: adminSession })
    await screen.findByText('Fran Finance')

    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    fireEvent.change(screen.getByLabelText('New password for Fran Finance'), {
      target: { value: 'a-new-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('New password for Fran Finance')).toBeNull()
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
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
