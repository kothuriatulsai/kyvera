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
// from storage, an injected script can read too. A page reload still restores the
// session, though - not from here, but via the httpOnly refresh cookie (ADR 0012),
// which this module never touches directly; `AuthProvider` calls `POST /auth/refresh`.
// `AuthProvider` is the only writer here; everything else just calls the API.
let accessToken: string | null = null
let onSessionEnded: (() => void) | null = null
let onForbidden: (() => void) | null = null
let onRefreshNeeded: (() => Promise<boolean>) | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function hasAccessToken(): boolean {
  return accessToken !== null
}

/** Called when an authenticated request comes back 401 and a refresh either
 * wasn't attempted or didn't help - the session is actually over. */
export function setSessionEndedHandler(handler: (() => void) | null) {
  onSessionEnded = handler
}

/**
 * Called when an authenticated request comes back 403 - the caller's role or
 * password-change requirement may have changed since the session started
 * (an admin reset their password, or changed their role) and the UI should
 * resync from `GET /auth/me` rather than just show the error.
 */
export function setForbiddenHandler(handler: (() => void) | null) {
  onForbidden = handler
}

/**
 * Called on a 401 before giving up on it (ADR 0012): the handler attempts a
 * refresh and resolves `true` if it worked, in which case the request that
 * triggered this is retried once with the new token. Registered by
 * `AuthProvider`, which also uses the same refresh path proactively and on
 * mount - this is just its reactive fallback for whenever a proactive
 * refresh didn't happen in time.
 */
export function setRefreshHandler(handler: (() => Promise<boolean>) | null) {
  onRefreshNeeded = handler
}

interface RawRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  headers: Record<string, string>
  body?: BodyInit
  authenticated: boolean
  /** 'include' for the cookie-authenticated auth endpoints (login/refresh/
   * logout) - the web app and API are different origins even in dev (just
   * different ports), so the default 'same-origin' would neither send nor
   * store the refresh cookie at all. */
  credentials?: RequestCredentials
}

/**
 * The fetch/error-handling plumbing shared by every request shape (JSON body,
 * multipart form, blob response): auth header, the "API is unreachable" case,
 * the API's `{ error }` body on a non-2xx response, retrying once after a
 * silent refresh on a 401, and ending the session if that didn't help.
 * Returns the raw, successful `Response` - callers decide how to read its
 * body (`rawRequest` below reads JSON; `apiGetBlob` reads a `Blob`).
 */
async function rawFetch(path: string, options: RawRequestOptions, isRetry = false): Promise<Response> {
  const headers = { ...options.headers }
  if (options.authenticated && accessToken) headers.Authorization = `Bearer ${accessToken}`

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method,
      headers,
      body: options.body,
      credentials: options.credentials,
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
    if (res.status === 401 && options.authenticated && !isRetry && onRefreshNeeded) {
      const refreshed = await onRefreshNeeded()
      if (refreshed) {
        return rawFetch(path, options, true)
      }
    }
    // The API's error middleware always responds with `{ error: string }`.
    const errorBody = (await res.json().catch(() => null)) as { error?: string } | null
    if (res.status === 401 && options.authenticated) onSessionEnded?.()
    if (res.status === 403 && options.authenticated) onForbidden?.()
    throw new ApiError(res.status, errorBody?.error ?? `Request failed with status ${res.status}`)
  }

  return res
}

async function rawRequest<T>(path: string, options: RawRequestOptions): Promise<T> {
  const res = await rawFetch(path, options)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /**
   * Send the token, and treat a 401 as "session over" (after trying a silent
   * refresh first). Off for login/refresh/logout themselves: a 401 there
   * just means the credentials or cookie were no good, and there is no
   * already-established session to end or retry.
   */
  authenticated?: boolean
  credentials?: RequestCredentials
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, authenticated = true, credentials } = options
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  return rawRequest<T>(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    authenticated,
    credentials,
  })
}

export const apiGet = <T>(path: string) => apiRequest<T>(path)

export const apiPost = <T>(path: string, body: unknown = {}) =>
  apiRequest<T>(path, { method: 'POST', body })

export const apiPatch = <T>(path: string, body: unknown = {}) =>
  apiRequest<T>(path, { method: 'PATCH', body })

/**
 * POST a `FormData` body - file uploads. No `Content-Type` header is set: the
 * browser attaches its own `multipart/form-data` boundary, and setting one by
 * hand would omit that boundary and break the upload.
 */
export const apiPostMultipart = <T>(path: string, body: FormData) =>
  rawRequest<T>(path, { method: 'POST', headers: {}, body, authenticated: true })

/** GET a binary response (a file download) as a `Blob`, instead of JSON. */
export const apiGetBlob = async (path: string): Promise<Blob> => {
  const res = await rawFetch(path, { method: 'GET', headers: {}, authenticated: true })
  return res.blob()
}
