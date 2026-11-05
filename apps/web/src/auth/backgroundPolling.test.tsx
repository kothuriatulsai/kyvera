import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminUser } from '../test/fixtures'
import { route, stubApi, type MockRoute } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

/**
 * ADR 0014: the nav badge / notification bell's 60s background poll must be
 * fully inert from the ADR 0012 refresh/idle-timeout machinery's point of
 * view - it must not reset the idle clock, must not trigger a reactive
 * refresh on a 401, and must not end the session. These tests prove that by
 * running the poll for real (fake-timer ticks, same mechanism as
 * `auth.test.tsx`'s own idle-timeout tests) across an otherwise-idle window
 * and checking the real auth machinery's schedule is untouched by it.
 */

const loginRoute: MockRoute = {
  method: 'POST',
  path: '/auth/login',
  respond: () => ({
    body: {
      token: 'tok-1',
      tokenType: 'Bearer',
      expiresIn: 3600,
      idleTimeoutSeconds: 1800,
      user: adminUser,
    },
  }),
}

function logIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@kyvera.dev' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right' } })
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

describe('background task/notification polling vs. the idle timeout (ADR 0012 x ADR 0014)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a 401 from the background poll does not call /auth/refresh and does not end the session early', async () => {
    // Starts healthy so the page's own *real* initial fetch (via `apiGet`,
    // which does react to a 401) succeeds normally and settles before the
    // switch below - what this test isolates is the silent poll's own
    // later ticks, not the ordinary page-load recovery path.
    let tokenExpired = false
    const api = stubApi([
      loginRoute,
      {
        method: 'GET',
        path: '/me/tasks',
        respond: () =>
          tokenExpired ? { status: 401, body: { error: 'Token has expired' } } : { body: [] },
      },
      {
        method: 'GET',
        path: '/me/notifications/unread-count',
        respond: () =>
          tokenExpired ? { status: 401, body: { error: 'Token has expired' } } : { body: { count: 0 } },
      },
    ])
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Log in' })
    logIn()
    await screen.findByRole('heading', { name: 'My tasks' })
    await screen.findByText('No tasks right now.')

    const refreshCallsAfterLogin = api.paths('POST').filter((p) => p === '/auth/refresh').length

    // Now simulate the access token expiring while the tab sits idle -
    // every poll tick from here on gets a 401, with nobody around to react.
    tokenExpired = true
    // Several poll ticks' worth of time, comfortably short of anything in
    // ADR 0012's own schedule (proactive refresh / idle warning) firing.
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    // The background poll called both endpoints repeatedly and got 401 every
    // time, but none of that reached the refresh path or ended the session.
    expect(api.paths('POST').filter((p) => p === '/auth/refresh').length).toBe(refreshCallsAfterLogin)
    expect(screen.queryByText(/session expired/i)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Log in' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'My tasks' })).toBeTruthy()
  })

  it('still shows the idle warning on schedule, and "Stay signed in" still works, with the poll ticking the whole time', async () => {
    let refreshCalls = 0
    const api = stubApi([
      loginRoute,
      route('GET', '/me/tasks', { body: [] }),
      route('GET', '/me/notifications/unread-count', { body: { count: 0 } }),
      {
        method: 'POST',
        path: '/auth/refresh',
        respond: () => {
          refreshCalls += 1
          return refreshCalls === 1
            ? { status: 401, body: { error: 'No valid refresh token' } }
            : {
                body: {
                  token: 'tok-stayed',
                  tokenType: 'Bearer',
                  expiresIn: 900,
                  idleTimeoutSeconds: 1800,
                  user: adminUser,
                },
              }
        },
      },
    ])
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Log in' })
    logIn()
    await screen.findByRole('heading', { name: 'My tasks' })
    // One call already happened: the mount-time silent-restore attempt
    // (before login), which 401s since nothing mocks a refresh cookie yet.
    const refreshCallsAfterLogin = refreshCalls

    // No clicks/keydowns here - purely idle except for the poll, which must
    // not count as activity (ADR 0012's proactive refresh only fires if
    // `activityRef` moved since the last refresh) and must not itself
    // refresh the session (that would defeat the idle timeout entirely).
    await vi.advanceTimersByTimeAsync(1800_000 - 60_000 + 1_000)
    await screen.findByText(/logged out in about a minute/i)

    // The poll kept running the whole time, hitting real, successful
    // endpoints repeatedly - it just never touched the idle clock or the
    // refresh path.
    expect(api.paths('GET').filter((p) => p === '/me/tasks').length).toBeGreaterThan(10)
    expect(refreshCalls).toBe(refreshCallsAfterLogin)

    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))

    await waitFor(() => expect(refreshCalls).toBeGreaterThan(refreshCallsAfterLogin))
    await waitFor(() => expect(screen.queryByText(/logged out in about a minute/i)).toBeNull())
    expect(screen.queryByText(/session expired/i)).toBeNull()
  })
})
