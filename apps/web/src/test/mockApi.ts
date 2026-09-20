import { vi } from 'vitest'

export interface MockRequest {
  method: string
  path: string
  /** The Authorization header the request carried, or null if it sent none. */
  authorization: string | null
  body: unknown
}

export interface MockReply {
  status?: number
  body?: unknown
}

/** Reply `'network-error'` to make fetch itself reject, as it does on a CORS block. */
export type MockResult = MockReply | 'network-error'

export interface MockRoute {
  method: string
  path: string | RegExp
  respond: (request: MockRequest) => MockResult
}

/** A route that always answers the same thing. */
export function route(method: string, path: string | RegExp, reply: MockResult): MockRoute {
  return { method, path, respond: () => reply }
}

/**
 * Replaces `fetch` with a stub that answers from `routes`, records every request,
 * and 404s anything not listed. Recording is the point: several tests assert what
 * the frontend did *not* ask for.
 */
export function stubApi(routes: MockRoute[]) {
  const calls: MockRequest[] = []

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    const request: MockRequest = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      authorization: headers.get('Authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(request)

    const match = routes.find(
      (r) =>
        r.method === request.method &&
        (typeof r.path === 'string' ? r.path === request.path : r.path.test(request.path)),
    )
    const result: MockResult = match?.respond(request) ?? { status: 404, body: { error: 'Not found' } }

    if (result === 'network-error') throw new TypeError('Failed to fetch')

    const { status = 200, body } = result
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  vi.stubGlobal('fetch', fetchMock)

  return {
    fetchMock,
    calls,
    /** Paths requested, in order, optionally only for one method. */
    paths: (method?: string) =>
      calls.filter((c) => method === undefined || c.method === method).map((c) => c.path),
  }
}
