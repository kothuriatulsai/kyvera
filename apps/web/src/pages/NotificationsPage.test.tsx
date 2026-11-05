import type { Notification } from '@kyvera/shared-types'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { adminSession } from '../test/fixtures'
import { route, stubApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

const UNREAD: Notification = {
  id: 'n-1',
  type: 'TECH_PACK_VERSION_UPLOADED',
  message: 'TP-000002 v1 is ready for review.',
  link: '/tech-packs/tp-2',
  createdAt: '2026-10-10T00:00:00.000Z',
  readAt: null,
}

const READ: Notification = {
  id: 'n-2',
  type: 'PROJECT_MEMBER_ADDED',
  message: 'You were added to project PRJ-000001.',
  link: '/projects/pr-1',
  createdAt: '2026-10-09T00:00:00.000Z',
  readAt: '2026-10-09T01:00:00.000Z',
}

describe('GET /me/notifications', () => {
  it('lists notifications and says so when there are none', async () => {
    stubApi([route('GET', '/me/notifications', { body: { items: [], nextCursor: null } })])
    renderApp('/notifications', { session: adminSession })

    await screen.findByText('No notifications yet.')
  })

  it('renders each notification and marks one read on click, then navigates to its link', async () => {
    const api = stubApi([
      route('GET', '/me/notifications', { body: { items: [UNREAD, READ], nextCursor: null } }),
      route('POST', '/me/notifications/n-1/read', { status: 204 }),
      route('GET', '/tech-packs/tp-2', { status: 404, body: { error: 'Not found' } }),
    ])
    renderApp('/notifications', { session: adminSession })

    const row = await screen.findByText('TP-000002 v1 is ready for review.')
    fireEvent.click(row)

    await screen.findByText('Not found')
    expect(api.calls.find((c) => c.path === '/me/notifications/n-1/read')?.method).toBe('POST')
  })

  it('does not call mark-read again for one already read', async () => {
    const api = stubApi([
      route('GET', '/me/notifications', { body: { items: [READ], nextCursor: null } }),
      route('GET', '/projects/pr-1', { status: 404, body: { error: 'Not found' } }),
    ])
    renderApp('/notifications', { session: adminSession })

    fireEvent.click(await screen.findByText('You were added to project PRJ-000001.'))

    await screen.findByText('Not found')
    expect(api.calls.some((c) => c.path.includes('/read'))).toBe(false)
  })

  it('"Mark all as read" clears every unread notification', async () => {
    const api = stubApi([
      route('GET', '/me/notifications', { body: { items: [UNREAD], nextCursor: null } }),
      route('POST', '/me/notifications/read-all', { status: 204 }),
    ])
    renderApp('/notifications', { session: adminSession })
    await screen.findByText('TP-000002 v1 is ready for review.')

    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))

    await screen.findByRole('button', { name: 'Mark all as read' })
    expect(
      (screen.getByRole('button', { name: 'Mark all as read' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(api.calls.some((c) => c.path === '/me/notifications/read-all' && c.method === 'POST')).toBe(
      true,
    )
  })

  it('shows a "Load more" button only while there is a next page', async () => {
    // mockApi matches on pathname only (query strings are stripped), so
    // telling the first and second page apart needs a stateful responder,
    // not two routes for the same path - same pattern other tests here use
    // to simulate "succeeds on retry".
    let calls = 0
    stubApi([
      {
        method: 'GET',
        path: '/me/notifications',
        respond: () => {
          calls += 1
          return calls === 1
            ? { body: { items: [UNREAD], nextCursor: 'n-1' } }
            : { body: { items: [READ], nextCursor: null } }
        },
      },
    ])
    renderApp('/notifications', { session: adminSession })
    await screen.findByText('TP-000002 v1 is ready for review.')

    const loadMore = screen.getByRole('button', { name: 'Load more' })
    fireEvent.click(loadMore)

    await screen.findByText('You were added to project PRJ-000001.')
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('surfaces the API error message when the request fails', async () => {
    stubApi([route('GET', '/me/notifications', { status: 500, body: { error: 'Something broke' } })])
    renderApp('/notifications', { session: adminSession })

    expect((await screen.findByRole('alert')).textContent).toBe('Something broke')
  })
})
