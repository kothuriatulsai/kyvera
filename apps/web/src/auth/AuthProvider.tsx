import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { login as loginRequest } from '../api/auth'
import { hasAccessToken, setAccessToken, setSessionEndedHandler } from '../api/client'
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
    return () => setSessionEndedHandler(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ session, notice, login, logout }),
    [session, notice, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
