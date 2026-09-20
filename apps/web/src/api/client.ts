const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000'

export class ApiError extends Error {
  /** HTTP status, or 0 when no response arrived at all (network error, CORS block). */
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// The access token lives here, in memory, for the life of the page. It is never
// written to localStorage, sessionStorage or a cookie: anything a script can read
// from storage, an injected script can read too. The cost is that a hard refresh
// loses it and the user logs in again (there is no refresh-token flow yet).
// `AuthProvider` is the only writer; everything else just calls the API.
let accessToken: string | null = null
let onSessionEnded: (() => void) | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function hasAccessToken(): boolean {
  return accessToken !== null
}

/** Called when an authenticated request comes back 401 (expired or invalid token). */
export function setSessionEndedHandler(handler: (() => void) | null) {
  onSessionEnded = handler
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /**
   * Send the token, and treat a 401 as "session over". Off for login itself: a 401
   * there just means the credentials were wrong, and there is no session to end.
   */
  authenticated?: boolean
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, authenticated = true } = options

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (authenticated && accessToken) headers.Authorization = `Bearer ${accessToken}`

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // fetch only rejects when no response arrived. That is almost always the API
    // being down, or the browser blocking the response because this page's origin
    // isn't on the API's CORS allowlist - which must not read like a login bug.
    throw new ApiError(
      0,
      `Could not reach the API at ${API_URL}. Is it running, and is this page's origin ` +
        'allowed by its CORS settings (CORS_ALLOWED_ORIGINS)?',
    )
  }

  if (!res.ok) {
    // The API's error middleware always responds with `{ error: string }`.
    const errorBody = (await res.json().catch(() => null)) as { error?: string } | null
    if (res.status === 401 && authenticated) onSessionEnded?.()
    throw new ApiError(res.status, errorBody?.error ?? `Request failed with status ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const apiGet = <T>(path: string) => apiRequest<T>(path)

export const apiPost = <T>(path: string, body: unknown = {}) =>
  apiRequest<T>(path, { method: 'POST', body })
