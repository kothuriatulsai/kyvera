import type { ChangePasswordRequest, LoginRequest, LoginResponse, UserSummary } from '@kyvera/shared-types'
import { apiGet, apiPost, apiRequest } from './client'

// Cross-origin even in dev (different ports), so these three need
// `credentials: 'include'` or the browser will neither send nor store the
// refresh cookie at all (ADR 0012). `fetchMe`/`changePassword` use the
// Bearer token instead and need no cookie handling.
export const login = (credentials: LoginRequest) =>
  apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: credentials,
    authenticated: false,
    credentials: 'include',
  })

/** Restores a session from the refresh cookie - on page load, proactively
 * before the access token expires, or reactively after a 401. Same response
 * shape as `login`, since it does the same thing: mint a fresh access token
 * for an existing, still-valid session. */
export const refresh = () =>
  apiRequest<LoginResponse>('/auth/refresh', {
    method: 'POST',
    authenticated: false,
    credentials: 'include',
  })

/** Revokes the current session. Not `authenticated` - it's identified by the
 * refresh cookie, not the (possibly already-expired) access token. */
export const logout = () =>
  apiRequest<void>('/auth/logout', {
    method: 'POST',
    authenticated: false,
    credentials: 'include',
  })

export const fetchMe = () => apiGet<UserSummary>('/auth/me')

export const changePassword = (body: ChangePasswordRequest) =>
  apiPost<UserSummary>('/auth/change-password', body)
