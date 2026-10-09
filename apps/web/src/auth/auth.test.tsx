import type { Project } from '@kyvera/shared-types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminSession, adminUser, pmoSession, pmoUser } from '../test/fixtures'
import { apiGet } from '../api/client'
import type { Session } from './authContext'
import { route, stubApi, type MockRoute } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

const PROJECT: Project = {
  id: 'pr-1',
  code: 'PRJ-000001',
  name: 'Solar Lantern Proto',
  productName: 'Solar Lantern',
  productCategory: null,
  phase: 'PROTO',
  status: 'ACTIVE',
  protoCompletedAt: null,
  completedAt: null,
  createdById: adminUser.id,
  createdBy: adminUser,
  createdAt: '2026-09-01T00:00:00.000Z',
}

const loginRoute: MockRoute = {
  method: 'POST',
  path: '/auth/login',
  respond: (request) =>
    (request.body as { password: string }).password === 'right'
      ? {
          body: {
            token: 'tok-1',
            tokenType: 'Bearer',
            expiresIn: 3600,
            idleTimeoutSeconds: 1800,
            user: adminUser,
          },
        }
      : { status: 401, body: { error: 'Invalid email or password' } },
}

const dataRoutes: MockRoute[] = [route('GET', '/projects', { body: [PROJECT] })]

function logIn(password = 'right') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@kyvera.dev' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

describe('login', () => {
  it('logs in, goes to the projects page, and sends the token from then on', async () => {
    const api = stubApi([loginRoute, ...dataRoutes])
    renderApp('/login')
    // The mount-time silent-restore check (ADR 0012) runs first, finds no
    // session (nothing here mocks /auth/refresh, so it 404s), and only then
    // does the login page actually appear.
    await screen.findByRole('heading', { name: 'Log in' })

    logIn()

    await screen.findByText('PRJ-000001')
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy()
    // The login request itself carries no token; everything after it does.
    const loginCall = api.calls.find((c) => c.path === '/auth/login')!
    expect(loginCall).toMatchObject({ method: 'POST', path: '/auth/login', authorization: null })
    expect(loginCall.body).toEqual({ email: 'admin@kyvera.dev', password: 'right' })
    for (const call of api.calls.slice(api.calls.indexOf(loginCall) + 1)) {
      expect(call.authorization).toBe('Bearer tok-1')
    }
    // ...and the header now shows who is logged in.
    expect(screen.getByText('Alex Admin')).toBeTruthy()
  })

  it('keeps the token in memory only: nothing is written to browser storage', async () => {
    stubApi([loginRoute, ...dataRoutes])
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Log in' })

    logIn()
    await screen.findByText('PRJ-000001')

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  })

  it('rejects a wrong password with a clear message, and stays on the login page', async () => {
    const api = stubApi([loginRoute, ...dataRoutes])
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Log in' })

    logIn('wrong')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Invalid email or password')
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy()
    // A failed login is not an "expired session", and nothing protected was fetched.
    expect(screen.queryByText(/session expired/i)).toBeNull()
    expect(api.paths()).toEqual(['/auth/refresh', '/auth/login'])
    expect(screen.queryByText('Log out')).toBeNull()
  })

  it('says so plainly when the API cannot be reached, instead of looking like a bad password', async () => {
    // What a browser does when the API is down or a CORS check fails: fetch rejects.
    stubApi([route('POST', '/auth/login', 'network-error')])
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Log in' })

    logIn()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/could not reach the api/i)
    expect(alert.textContent).toMatch(/cors/i)
    expect(alert.textContent).not.toMatch(/invalid email or password/i)
  })

  it('sends someone who is already logged in straight past the login page', async () => {
    stubApi(dataRoutes)
    renderApp('/login', { session: adminSession })

    await screen.findByText('PRJ-000001')
    expect(screen.queryByRole('heading', { name: 'Log in' })).toBeNull()
  })
})

describe('protected routes', () => {
  it.each([['/'], ['/projects'], ['/no/such/page']])(
    'sends a logged-out visitor from %s to the login page, never calling anything but the silent-restore check',
    async (path) => {
      const api = stubApi([loginRoute, ...dataRoutes])
      renderApp(path)

      await screen.findByRole('heading', { name: 'Log in' })
      // The only call is the mount-time silent-restore attempt (ADR 0012),
      // which fails here (nothing mocks /auth/refresh) - nothing protected,
      // not even /projects, is ever requested for a logged-out visitor.
      expect(api.paths()).toEqual(['/auth/refresh'])
      // Not even the navigation is shown to someone who isn't logged in.
      expect(screen.queryByRole('link', { name: 'Projects' })).toBeNull()
    },
  )

  it('takes you back to where you were headed once you log in', async () => {
    const api = stubApi([
      loginRoute,
      route('GET', '/projects/pr-1', { body: PROJECT }),
      // Anchored to end: `/tech-packs/:id` is a real route too, and must not
      // be intercepted by the *list* endpoint's mock.
      route('GET', /^\/tech-packs$/, { body: [] }),
      route('GET', /^\/proto-requests$/, { body: [] }),
    ])
    renderApp('/projects/pr-1')

    await screen.findByRole('heading', { name: 'Log in' })
    logIn()

    await screen.findByRole('heading', { name: 'Solar Lantern Proto' })
    // It fetched the deep-linked project with the token - never anonymously.
    const projectCall = api.calls.find((c) => c.path === '/projects/pr-1')
    expect(projectCall?.authorization).toBe('Bearer tok-1')
  })
})

describe('logout', () => {
  it('clears the session: back to login, and no token on anything after', async () => {
    const api = stubApi([loginRoute, ...dataRoutes, route('POST', '/auth/logout', { status: 204 })])
    renderApp('/projects', { session: adminSession })
    await screen.findByText('PRJ-000001')
    const callsBefore = api.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    await screen.findByRole('heading', { name: 'Log in' })
    expect(screen.getByText('You have been logged out.')).toBeTruthy()
    expect(screen.queryByText('Alex Admin')).toBeNull()
    // The one new call is logout revoking the session server-side (ADR 0012).
    expect(api.calls.length).toBe(callsBefore + 1)

    // The token itself is gone, not just hidden: any request made now goes out bare.
    await apiGet('/projects').catch(() => undefined)
    expect(api.calls.at(-1)).toMatchObject({ path: '/projects', authorization: null })
    const callsAfterProbe = api.calls.length

    // A later login starts from a clean slate: the token in use is the new one, not
    // the old one, and nothing sends the old one.
    logIn()
    await screen.findByText('PRJ-000001')
    const after = api.calls.slice(callsAfterProbe)
    expect(after.some((c) => c.authorization === 'Bearer tok-admin')).toBe(false)
    expect(after.filter((c) => c.path !== '/auth/login').every((c) => c.authorization === 'Bearer tok-1')).toBe(true)
  })

  it('does not send the next person who logs in to the page the last one was on', async () => {
    stubApi([loginRoute, ...dataRoutes, route('GET', /^\/proto-requests$/, { body: [] })])
    renderApp('/proto-requests', { session: adminSession })
    await screen.findByRole('heading', { name: 'Proto Requests' })

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    await screen.findByRole('heading', { name: 'Log in' })
    logIn()

    await screen.findByRole('heading', { name: 'Projects' })
    expect(screen.queryByRole('heading', { name: 'Proto Requests' })).toBeNull()
  })
})

describe('an expired or invalid token (a 401 from the API)', () => {
  it('sends the user to login with an explanation, instead of a broken page', async () => {
    stubApi([
      route('GET', '/projects', { status: 401, body: { error: 'Token has expired' } }),
      loginRoute,
    ])
    renderApp('/', { session: adminSession })

    await screen.findByRole('heading', { name: 'Log in' })
    expect(screen.getByText('Your session expired. Please log in again.')).toBeTruthy()
    expect(screen.queryByText('Alex Admin')).toBeNull()
    // No raw error, no unhandled rejection surfaced as a broken page.
    expect(screen.queryByText('Token has expired')).toBeNull()
  })

  it('drops the dead token, so logging in again works and returns to the page they were on', async () => {
    let expired = true
    const api = stubApi([
      {
        method: 'GET',
        path: '/projects',
        respond: () =>
          expired
            ? { status: 401, body: { error: 'Token has expired' } }
            : { body: [PROJECT] },
      },
      loginRoute,
    ])
    renderApp('/projects', { session: adminSession })
    await screen.findByText('Your session expired. Please log in again.')

    expired = false
    logIn()

    await screen.findByRole('heading', { name: 'Projects' })
    // The login request did not carry the dead token, and the retry used the new one.
    const loginCall = api.calls.find((c) => c.path === '/auth/login')
    expect(loginCall?.authorization).toBeNull()
    const lastProjects = api.calls.filter((c) => c.path === '/projects').at(-1)
    expect(lastProjects?.authorization).toBe('Bearer tok-1')
    // The notice is gone once they are back in.
    expect(screen.queryByText(/session expired/i)).toBeNull()
  })

  it('also ends the session when a 401 comes back from an action, not just a page load', async () => {
    stubApi([
      route('GET', '/projects', { body: [] }),
      route('POST', '/projects', { status: 401, body: { error: 'Token has expired' } }),
    ])
    renderApp('/projects', { session: pmoSession })

    await screen.findByText('No projects yet.')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Name' } })
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Product' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy())
    expect(screen.getByText('Your session expired. Please log in again.')).toBeTruthy()
  })
})

describe('a forced password change (ADR 0011)', () => {
  const mustChangeSession: Session = {
    token: 'tok-reset',
    user: { ...adminUser, mustChangePassword: true },
  }

  it('redirects to My account from any route, instead of showing that route', async () => {
    stubApi([route('GET', '/projects', { body: [] })])
    renderApp('/projects', { session: mustChangeSession })

    await screen.findByRole('heading', { name: 'My account' })
    expect(screen.getByText(/must set a new one/i)).toBeTruthy()
    expect(screen.queryByText('No projects yet.')).toBeNull()
  })

  it('lets them change it, then navigates away and unblocks the rest of the app', async () => {
    const api = stubApi([
      route('POST', '/auth/change-password', { body: { ...adminUser, mustChangePassword: false } }),
      route('GET', '/projects', { body: [] }),
    ])
    renderApp('/projects', { session: mustChangeSession })
    await screen.findByRole('heading', { name: 'My account' })

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'the-temp-password' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-real-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await screen.findByText('No projects yet.')
    expect(api.calls.find((c) => c.path === '/auth/change-password')?.body).toEqual({
      currentPassword: 'the-temp-password',
      newPassword: 'a-real-password',
    })
  })
})

describe('a role changed while already logged in', () => {
  it('shows a notice and re-renders actions for the new role after a 403', async () => {
    stubApi([
      route('GET', '/projects', { body: [] }),
      route('POST', '/projects', { status: 403, body: { error: 'This action requires one of these roles: PMO, ADMIN' } }),
      route('GET', '/auth/me', { body: { ...pmoUser, role: 'FINANCE' } }),
    ])
    renderApp('/projects', { session: pmoSession })
    await screen.findByText('No projects yet.')
    expect(screen.getByRole('heading', { name: 'New project' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Name' } })
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Product' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await screen.findByText('Your role was changed to FINANCE.')
    // FINANCE can't create a Project - the form is gone now the session reflects that.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'New project' })).toBeNull())
  })

  it('re-syncs on window focus too', async () => {
    stubApi([
      route('GET', '/projects', { body: [] }),
      route('GET', '/auth/me', { body: { ...pmoUser, role: 'MANAGEMENT' } }),
    ])
    renderApp('/projects', { session: pmoSession })
    await screen.findByText('No projects yet.')

    window.dispatchEvent(new Event('focus'))

    await screen.findByText('Your role was changed to MANAGEMENT.')
  })

  it('can be dismissed', async () => {
    stubApi([
      route('GET', '/projects', { body: [] }),
      route('POST', '/projects', { status: 403, body: { error: 'forbidden' } }),
      route('GET', '/auth/me', { body: { ...pmoUser, role: 'FINANCE' } }),
    ])
    renderApp('/projects', { session: pmoSession })
    await screen.findByText('No projects yet.')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Name' } })
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Product' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await screen.findByText('Your role was changed to FINANCE.')

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByText('Your role was changed to FINANCE.')).toBeNull()
  })
})

describe('silent restore on page load (ADR 0012)', () => {
  it('restores the session from the refresh cookie, without ever showing the login page', async () => {
    const api = stubApi([
      route('POST', '/auth/refresh', {
        body: {
          token: 'tok-restored',
          tokenType: 'Bearer',
          expiresIn: 900,
          idleTimeoutSeconds: 1800,
          user: adminUser,
        },
      }),
      ...dataRoutes,
    ])
    renderApp('/projects')

    await screen.findByText('PRJ-000001')
    expect(screen.queryByRole('heading', { name: 'Log in' })).toBeNull()
    expect(api.calls[0]).toMatchObject({ method: 'POST', path: '/auth/refresh' })
    const projectsCall = api.calls.find((c) => c.path === '/projects')
    expect(projectsCall?.authorization).toBe('Bearer tok-restored')
  })

  it('shows the login page when there is no valid session to restore', async () => {
    stubApi([route('POST', '/auth/refresh', { status: 401, body: { error: 'No valid refresh token' } })])
    renderApp('/projects')

    await screen.findByRole('heading', { name: 'Log in' })
    // No "your session expired" notice - this visitor was never logged in
    // on this page load, so there's nothing to report ending.
    expect(screen.queryByText(/session expired/i)).toBeNull()
  })
})

describe('a 401 mid-session (ADR 0012)', () => {
  it('silently refreshes and retries the request, instead of ending the session', async () => {
    let attempts = 0
    const api = stubApi([
      {
        method: 'GET',
        path: '/projects',
        respond: () => {
          attempts += 1
          return attempts === 1 ? { status: 401, body: { error: 'Token has expired' } } : { body: [PROJECT] }
        },
      },
      route('POST', '/auth/refresh', {
        body: {
          token: 'tok-refreshed',
          tokenType: 'Bearer',
          expiresIn: 900,
          idleTimeoutSeconds: 1800,
          user: adminUser,
        },
      }),
    ])
    renderApp('/projects', { session: adminSession })

    await screen.findByText('PRJ-000001')
    expect(screen.queryByText(/session expired/i)).toBeNull()
    expect(api.calls.some((c) => c.path === '/auth/refresh')).toBe(true)
    const projectCalls = api.calls.filter((c) => c.path === '/projects')
    expect(projectCalls).toHaveLength(2)
    expect(projectCalls[1].authorization).toBe('Bearer tok-refreshed')
  })

  it('ends the session if the refresh itself fails', async () => {
    stubApi([
      route('GET', '/projects', { status: 401, body: { error: 'Token has expired' } }),
      route('POST', '/auth/refresh', { status: 401, body: { error: 'Session timed out from inactivity' } }),
    ])
    renderApp('/projects', { session: adminSession })

    await screen.findByRole('heading', { name: 'Log in' })
    expect(screen.getByText('Your session expired. Please log in again.')).toBeTruthy()
  })
})

describe('proactive refresh and the idle warning (ADR 0012)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes proactively before the access token expires, only if there has been activity', async () => {
    // The mount-time silent-restore call hits this same endpoint before
    // login happens at all - it must fail (no cookie yet) so the login page
    // actually renders. Only calls after that (the proactive refresh under
    // test) should succeed.
    let refreshCalls = 0
    stubApi([
      loginRoute,
      ...dataRoutes,
      {
        method: 'POST',
        path: '/auth/refresh',
        respond: () => {
          refreshCalls += 1
          return refreshCalls === 1
            ? { status: 401, body: { error: 'No valid refresh token' } }
            : {
                body: {
                  token: 'tok-proactive',
                  tokenType: 'Bearer',
                  expiresIn: 900,
                  idleTimeoutSeconds: 1800,
                  user: adminUser,
                },
              }
        },
      },
    ])
    // Fake timers from before login, so the one-shot timers scheduleTimers
    // sets up on login are themselves fake and controllable below -
    // switching afterward would leave them as real, unadvanceable timers.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Log in' })
    logIn()
    await screen.findByText('PRJ-000001')

    fireEvent.click(document.body) // activity, after login

    // The timer is scheduled off the login response's expiresIn (3600s via
    // loginRoute), not the later /auth/refresh mock's - just past that,
    // minus the 60s proactive buffer.
    await vi.advanceTimersByTimeAsync(3600_000 - 60_000 + 1_000)

    expect(refreshCalls).toBeGreaterThan(1)
  })

  it('does not refresh proactively if the tab has been idle', async () => {
    const api = stubApi([loginRoute, ...dataRoutes])
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Log in' })
    logIn()
    await screen.findByText('PRJ-000001')

    // The mount-time silent restore (before login) already called /auth/refresh
    // once; what matters here is that it isn't called again.
    const refreshCallsBeforeIdling = api.paths('POST').filter((p) => p === '/auth/refresh').length

    // No activity this time.
    await vi.advanceTimersByTimeAsync(3600_000 - 60_000 + 1_000)

    const refreshCallsAfterIdling = api.paths('POST').filter((p) => p === '/auth/refresh').length
    expect(refreshCallsAfterIdling).toBe(refreshCallsBeforeIdling)
  })

  it('shows a warning before the idle timeout, and "Stay signed in" dismisses it by refreshing', async () => {
    // Same reasoning as the proactive-refresh test above: the mount-time
    // silent-restore call must fail first, so the login page actually shows.
    let refreshCalls = 0
    stubApi([
      loginRoute,
      ...dataRoutes,
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
    await screen.findByText('PRJ-000001')

    // Just past idleTimeoutSeconds (1800s) minus the 60s warning lead - and
    // comfortably past the proactive-refresh point too, so this is purely
    // about the warning, not a side effect of a proactive refresh resetting
    // the idle clock first.
    await vi.advanceTimersByTimeAsync(1800_000 - 60_000 + 1_000)

    await screen.findByText(/logged out in about a minute/i)

    const refreshCallsBeforeClick = refreshCalls
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))

    await waitFor(() => expect(refreshCalls).toBeGreaterThan(refreshCallsBeforeClick))
    await waitFor(() => expect(screen.queryByText(/logged out in about a minute/i)).toBeNull())
  })
})
