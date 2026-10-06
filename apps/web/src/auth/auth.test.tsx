import type { Project } from '@kyvera/shared-types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { adminSession, adminUser, pmoSession } from '../test/fixtures'
import { apiGet } from '../api/client'
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
      ? { body: { token: 'tok-1', tokenType: 'Bearer', expiresIn: 3600, user: adminUser } }
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

    logIn()

    await screen.findByText('PRJ-000001')
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy()
    // The login request itself carries no token; everything after it does.
    expect(api.calls[0]).toMatchObject({ method: 'POST', path: '/auth/login', authorization: null })
    expect(api.calls[0].body).toEqual({ email: 'admin@kyvera.dev', password: 'right' })
    for (const call of api.calls.slice(1)) expect(call.authorization).toBe('Bearer tok-1')
    // ...and the header now shows who is logged in.
    expect(screen.getByText('Alex Admin')).toBeTruthy()
  })

  it('keeps the token in memory only: nothing is written to browser storage', async () => {
    stubApi([loginRoute, ...dataRoutes])
    renderApp('/login')

    logIn()
    await screen.findByText('PRJ-000001')

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  })

  it('rejects a wrong password with a clear message, and stays on the login page', async () => {
    const api = stubApi([loginRoute, ...dataRoutes])
    renderApp('/login')

    logIn('wrong')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Invalid email or password')
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy()
    // A failed login is not an "expired session", and nothing protected was fetched.
    expect(screen.queryByText(/session expired/i)).toBeNull()
    expect(api.paths()).toEqual(['/auth/login'])
    expect(screen.queryByText('Log out')).toBeNull()
  })

  it('says so plainly when the API cannot be reached, instead of looking like a bad password', async () => {
    // What a browser does when the API is down or a CORS check fails: fetch rejects.
    stubApi([route('POST', '/auth/login', 'network-error')])
    renderApp('/login')

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
    'sends a logged-out visitor from %s to the login page without calling the API',
    async (path) => {
      const api = stubApi([loginRoute, ...dataRoutes])
      renderApp(path)

      await screen.findByRole('heading', { name: 'Log in' })
      expect(api.calls).toEqual([])
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
    const api = stubApi([loginRoute, ...dataRoutes])
    renderApp('/projects', { session: adminSession })
    await screen.findByText('PRJ-000001')
    const callsBefore = api.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    await screen.findByRole('heading', { name: 'Log in' })
    expect(screen.getByText('You have been logged out.')).toBeTruthy()
    expect(screen.queryByText('Alex Admin')).toBeNull()
    expect(api.calls.length).toBe(callsBefore) // nothing more is fetched

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
