import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  adminSession,
  adminUser,
  lateDelay,
  lateDetail,
  lateProduct,
  onTimeProduct,
  stages,
} from '../test/fixtures'
import { apiGet } from '../api/client'
import { route, stubApi, type MockRoute } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

const loginRoute: MockRoute = {
  method: 'POST',
  path: '/auth/login',
  respond: (request) =>
    (request.body as { password: string }).password === 'right'
      ? { body: { token: 'tok-1', tokenType: 'Bearer', expiresIn: 3600, user: adminUser } }
      : { status: 401, body: { error: 'Invalid email or password' } },
}

const dataRoutes: MockRoute[] = [
  route('GET', '/products', { body: [onTimeProduct, lateProduct] }),
  route('GET', '/stages', { body: stages }),
  route('GET', '/products/p-late', { body: lateDetail }),
  route('GET', '/products/p-late/delay', { body: lateDelay }),
]

function logIn(password = 'right') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@kyvera.dev' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

describe('login', () => {
  it('logs in, goes to the products page, and sends the token from then on', async () => {
    const api = stubApi([loginRoute, ...dataRoutes])
    renderApp('/login')

    logIn()

    await screen.findByText('Overdue Gadget')
    expect(screen.getByRole('heading', { name: 'Products' })).toBeTruthy()
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
    await screen.findByText('Overdue Gadget')

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

    await screen.findByText('Overdue Gadget')
    expect(screen.queryByRole('heading', { name: 'Log in' })).toBeNull()
  })
})

describe('protected routes', () => {
  it.each([['/'], ['/delayed'], ['/products/p-late'], ['/no/such/page']])(
    'sends a logged-out visitor from %s to the login page without calling the API',
    async (path) => {
      const api = stubApi([loginRoute, ...dataRoutes])
      renderApp(path)

      await screen.findByRole('heading', { name: 'Log in' })
      expect(api.calls).toEqual([])
      // Not even the navigation is shown to someone who isn't logged in.
      expect(screen.queryByRole('link', { name: 'Products' })).toBeNull()
    },
  )

  it('takes you back to where you were headed once you log in', async () => {
    const api = stubApi([loginRoute, ...dataRoutes])
    renderApp('/products/p-late')

    await screen.findByRole('heading', { name: 'Log in' })
    logIn()

    await screen.findByRole('heading', { name: 'Overdue Gadget' })
    // It fetched the deep-linked product with the token - never anonymously.
    const productCall = api.calls.find((c) => c.path === '/products/p-late')
    expect(productCall?.authorization).toBe('Bearer tok-1')
  })
})

describe('logout', () => {
  it('clears the session: back to login, and no token on anything after', async () => {
    const api = stubApi([loginRoute, ...dataRoutes])
    renderApp('/delayed', { session: adminSession })
    await screen.findByText('Overdue Gadget')
    const callsBefore = api.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    await screen.findByRole('heading', { name: 'Log in' })
    expect(screen.getByText('You have been logged out.')).toBeTruthy()
    expect(screen.queryByText('Alex Admin')).toBeNull()
    expect(api.calls.length).toBe(callsBefore) // nothing more is fetched

    // The token itself is gone, not just hidden: any request made now goes out bare.
    await apiGet('/products').catch(() => undefined)
    expect(api.calls.at(-1)).toMatchObject({ path: '/products', authorization: null })
    const callsAfterProbe = api.calls.length

    // A later login starts from a clean slate: the token in use is the new one, not
    // the old one, and nothing sends the old one.
    logIn()
    await screen.findByText('Overdue Gadget')
    const after = api.calls.slice(callsAfterProbe)
    expect(after.some((c) => c.authorization === 'Bearer tok-admin')).toBe(false)
    expect(after.filter((c) => c.path !== '/auth/login').every((c) => c.authorization === 'Bearer tok-1')).toBe(true)
  })

  it('does not send the next person who logs in to the page the last one was on', async () => {
    stubApi([loginRoute, ...dataRoutes])
    renderApp('/delayed', { session: adminSession })
    await screen.findByRole('heading', { name: 'Delayed products' })

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    await screen.findByRole('heading', { name: 'Log in' })
    logIn()

    await screen.findByRole('heading', { name: 'Products' })
    expect(screen.queryByRole('heading', { name: 'Delayed products' })).toBeNull()
  })
})

describe('an expired or invalid token (a 401 from the API)', () => {
  it('sends the user to login with an explanation, instead of a broken page', async () => {
    stubApi([
      route('GET', '/products', { status: 401, body: { error: 'Token has expired' } }),
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
        path: '/products',
        respond: () =>
          expired
            ? { status: 401, body: { error: 'Token has expired' } }
            : { body: [onTimeProduct, lateProduct] },
      },
      loginRoute,
    ])
    renderApp('/delayed', { session: adminSession })
    await screen.findByText('Your session expired. Please log in again.')

    expired = false
    logIn()

    await screen.findByRole('heading', { name: 'Delayed products' })
    // The login request did not carry the dead token, and the retry used the new one.
    const loginCall = api.calls.find((c) => c.path === '/auth/login')
    expect(loginCall?.authorization).toBeNull()
    const lastProducts = api.calls.filter((c) => c.path === '/products').at(-1)
    expect(lastProducts?.authorization).toBe('Bearer tok-1')
    // The notice is gone once they are back in.
    expect(screen.queryByText(/session expired/i)).toBeNull()
  })

  it('also ends the session when a 401 comes back from an action, not just a page load', async () => {
    stubApi([
      route('GET', '/products/p-assigned', {
        body: {
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
              readiness: { state: 'open_now', opensInDays: null },
              delay: null,
              history: [],
              notes: [],
            },
          ],
        },
      }),
      route('POST', '/products/p-assigned/assignments/a1/ready', {
        status: 401,
        body: { error: 'Token has expired' },
      }),
    ])
    renderApp('/products/p-assigned', { session: adminSession })

    fireEvent.click(await screen.findByRole('button', { name: 'Mark my part ready' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy())
    expect(screen.getByText('Your session expired. Please log in again.')).toBeTruthy()
  })
})
