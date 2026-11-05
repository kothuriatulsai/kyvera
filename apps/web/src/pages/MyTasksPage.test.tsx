import type { Task } from '@kyvera/shared-types'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { adminSession, productDesignerSession } from '../test/fixtures'
import { route, stubApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

const UPLOAD_TASK: Task = {
  type: 'UPLOAD_FIRST_VERSION',
  message: 'Upload v1 for TP-000002.',
  link: '/tech-packs/tp-2',
  projectId: 'pr-1',
  projectCode: 'PRJ-000001',
  techPackId: 'tp-2',
  techPackCode: 'TP-000002',
}

describe('GET /me/tasks', () => {
  it('is the home page, listing each task as a link to where it points', async () => {
    stubApi([route('GET', '/me/tasks', { body: [UPLOAD_TASK] })])
    renderApp('/', { session: productDesignerSession })

    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Upload v1 for TP-000002.' })
    expect(link.getAttribute('href')).toBe('/tech-packs/tp-2')
    expect(screen.getByText('(PRJ-000001)')).toBeTruthy()
  })

  it('says so when there are no tasks right now', async () => {
    stubApi([route('GET', '/me/tasks', { body: [] })])
    renderApp('/', { session: adminSession })

    await screen.findByText('No tasks right now.')
  })

  it('surfaces the API error message when the request fails', async () => {
    stubApi([route('GET', '/me/tasks', { status: 500, body: { error: 'Something broke' } })])
    renderApp('/', { session: adminSession })

    expect((await screen.findByRole('alert')).textContent).toBe('Something broke')
  })

  it('shows the nav badge once the background poll resolves, and it goes to "/"', async () => {
    stubApi([route('GET', '/me/tasks', { body: [UPLOAD_TASK] })])
    renderApp('/account', { session: productDesignerSession })

    const link = await screen.findByRole('link', { name: 'My tasks (1)' })
    expect(link.getAttribute('href')).toBe('/')
  })
})

describe('Notifications bell', () => {
  it('shows the unread count from the background poll and opens the dropdown on click', async () => {
    stubApi([
      route('GET', '/me/tasks', { body: [] }),
      route('GET', '/me/notifications/unread-count', { body: { count: 3 } }),
      route('GET', '/me/notifications', { body: { items: [], nextCursor: null } }),
    ])
    renderApp('/', { session: adminSession })

    const bell = await screen.findByRole('button', { name: 'Notifications (3)' })
    fireEvent.click(bell)

    await screen.findByText('No notifications yet.')
  })
})
