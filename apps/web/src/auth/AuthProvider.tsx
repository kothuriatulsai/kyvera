import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { UserSummary } from '@kyvera/shared-types'
import { fetchMe, login as loginRequest } from '../api/auth'
import { hasAccessToken, setAccessToken, setForbiddenHandler, setSessionEndedHandler } from '../api/client'
import { AuthContext, type AuthContextValue, type LoginNotice, type Session } from './authContext'

interface AuthProviderProps {
  children: ReactNode
  /** Start already logged in. A seam for tests; nothing in the app passes it. */
  initialSession?: Session
}

/**
 * Holds who is logged in, in memory only (see api/client.ts for why). Logging out
 * just drops the token: the API is stateless, so there is nothing server-side to
 * revoke, and a token that was copied elsewhere stays valid until it expires. That
 * is a deliberate simplicity for now, not an oversight.
 */
export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(() => {
    if (initialSession) setAccessToken(initialSession.token)
    return initialSession ?? null
  })
  const [notice, setNotice] = useState<LoginNotice>(null)
  const [roleChangeNotice, setRoleChangeNotice] = useState<string | null>(null)

  // Read inside the resync below without forcing it to depend on (and be
  // re-created whenever) `session` changes - the same "latest ref" pattern
  // `useAsyncWithReload` already uses for its own stale-closure problem.
  const sessionRef = useRef(session)
  useEffect(() => {
    sessionRef.current = session
  })

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginRequest({ email, password })
    // The token goes into the client *before* state changes, so the very first
    // request the newly-rendered pages make already carries it.
    setAccessToken(result.token)
    setSession({ token: result.token, user: result.user })
    setNotice(null)
  }, [])

  const logout = useCallback(() => {
    setAccessToken(null)
    setSession(null)
    setNotice('signed-out')
  }, [])

  const applyUserUpdate = useCallback((user: UserSummary) => {
    setSession((prev) => (prev ? { ...prev, user } : prev))
  }, [])

  const dismissRoleChangeNotice = useCallback(() => setRoleChangeNotice(null), [])

  // Resyncs from the server without a full page load: an admin can change
  // someone's role or force a password change while that person is already
  // logged in elsewhere, and the only sign of it otherwise would be a
  // confusing 403 on whatever they click next.
  const resync = useCallback(async () => {
    if (!sessionRef.current || !hasAccessToken()) return
    let fresh: UserSummary
    try {
      fresh = await fetchMe()
    } catch {
      // A real session problem (expired/invalid token) is handled by the
      // session-ended path already triggered on the same failing request.
      return
    }
    if (fresh.role !== sessionRef.current.user.role) {
      setRoleChangeNotice(`Your role was changed to ${fresh.role}.`)
    }
    setSession((prev) => (prev ? { ...prev, user: fresh } : prev))
  }, [])

  // A 401 on an authenticated request means the token has expired (or the user
  // was deleted): drop it and send them to log in, instead of leaving a broken page.
  // A layout effect, so it's registered before any child's data-fetching effect runs.
  useLayoutEffect(() => {
    setSessionEndedHandler(() => {
      // Nothing to end if nobody is logged in (a stray 401 must not raise a notice).
      if (!hasAccessToken()) return
      setAccessToken(null)
      setSession(null)
      setNotice('expired')
    })
    setForbiddenHandler(() => {
      void resync()
    })
    return () => {
      setSessionEndedHandler(null)
      setForbiddenHandler(null)
    }
  }, [resync])

  useEffect(() => {
    function onFocus() {
      void resync()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [resync])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      notice,
      roleChangeNotice,
      dismissRoleChangeNotice,
      login,
      logout,
      applyUserUpdate,
    }),
    [session, notice, roleChangeNotice, dismissRoleChangeNotice, login, logout, applyUserUpdate],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
