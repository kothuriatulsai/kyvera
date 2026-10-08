import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { LoginResponse, UserSummary } from '@kyvera/shared-types'
import { fetchMe, login as loginRequest, logout as logoutRequest, refresh as refreshRequest } from '../api/auth'
import {
  hasAccessToken,
  setAccessToken,
  setForbiddenHandler,
  setRefreshHandler,
  setSessionEndedHandler,
} from '../api/client'
import { AuthContext, type AuthContextValue, type LoginNotice, type Session } from './authContext'

interface AuthProviderProps {
  children: ReactNode
  /** Start already logged in, skipping the real silent-restore check on
   * mount. A seam for tests; nothing in the app passes it. */
  initialSession?: Session
}

const REFRESH_LOCK_NAME = 'kyvera-refresh'
// Refresh this long before the access token actually expires, so an active
// user's session renews before anything they do can hit a 401 at all.
const PROACTIVE_REFRESH_BUFFER_MS = 60_000
// Warn this long before the idle timeout would end the session.
const IDLE_WARNING_LEAD_MS = 60_000

/**
 * Runs `fn` serialized against other browser tabs on the same origin, via
 * the Web Locks API where it's available (ADR 0012). Without it, two tabs
 * refreshing at the same moment would both present the same refresh-token
 * secret; whichever the server processes second would look like reuse of
 * an already-rotated token. Falls back to running `fn` directly where the
 * API isn't supported - the server's own rotation grace window is the
 * backstop for that case, not a substitute for this one.
 */
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (!locks) return fn()
  return locks.request(REFRESH_LOCK_NAME, fn)
}

/**
 * Holds who is logged in. The access token lives in memory only (see
 * api/client.ts for why); what survives a reload is the httpOnly refresh
 * cookie (ADR 0012), restored here on mount so a reload or a typed URL
 * doesn't log anyone out. Logging out revokes the session server-side, not
 * just a local token drop - ADR 0012 makes that distinction real.
 */
export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(() => {
    if (initialSession) setAccessToken(initialSession.token)
    return initialSession ?? null
  })
  const [notice, setNotice] = useState<LoginNotice>(null)
  const [roleChangeNotice, setRoleChangeNotice] = useState<string | null>(null)
  const [idleWarningVisible, setIdleWarningVisible] = useState(false)
  // The mount-time silent-restore check is asynchronous; render nothing
  // (not the login page) until it settles, so a reload never flashes a
  // "logged out" state for someone who isn't.
  const [checkingInitialSession, setCheckingInitialSession] = useState(!initialSession)

  // Read inside resync/refreshNow without forcing them to depend on (and be
  // re-created whenever) `session` changes - the same "latest ref" pattern
  // `useAsyncWithReload` already uses for its own stale-closure problem.
  const sessionRef = useRef(session)
  useEffect(() => {
    sessionRef.current = session
  })

  const activityRef = useRef(Date.now())
  const lastRefreshAtRef = useRef(Date.now())
  const inFlightRefreshRef = useRef<Promise<boolean> | null>(null)
  const proactiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Breaks the refreshNow <-> scheduleTimers mutual reference: the proactive
  // timer needs to call the *current* refreshNow, which is itself defined
  // (and depends on scheduleTimers) further down.
  const refreshNowRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))

  const clearTimers = useCallback(() => {
    if (proactiveTimerRef.current !== null) clearTimeout(proactiveTimerRef.current)
    if (idleWarningTimerRef.current !== null) clearTimeout(idleWarningTimerRef.current)
    proactiveTimerRef.current = null
    idleWarningTimerRef.current = null
  }, [])

  // Schedules the next proactive refresh and the idle warning as one-shot
  // timers relative to this successful login/refresh - not a recurring
  // poll. The proactive one only actually refreshes if there has been real
  // activity since this moment; an idle tab lets both lapse and relies on
  // the next real request's reactive 401 -> refresh -> fail path to end
  // the session for real.
  const scheduleTimers = useCallback((expiresInSeconds: number, idleTimeoutSeconds: number) => {
    clearTimers()
    lastRefreshAtRef.current = Date.now()

    const proactiveDelay = Math.max(expiresInSeconds * 1000 - PROACTIVE_REFRESH_BUFFER_MS, 0)
    proactiveTimerRef.current = setTimeout(() => {
      if (activityRef.current > lastRefreshAtRef.current) {
        void refreshNowRef.current()
      }
    }, proactiveDelay)

    const warningDelay = Math.max(idleTimeoutSeconds * 1000 - IDLE_WARNING_LEAD_MS, 0)
    idleWarningTimerRef.current = setTimeout(() => setIdleWarningVisible(true), warningDelay)
  }, [clearTimers])

  const applySuccessfulAuth = useCallback(
    (result: LoginResponse) => {
      // The token goes into the client *before* state changes, so the very
      // first request the newly-rendered pages make already carries it.
      setAccessToken(result.token)
      setSession({ token: result.token, user: result.user })
      setIdleWarningVisible(false)
      scheduleTimers(result.expiresIn, result.idleTimeoutSeconds)
    },
    [scheduleTimers],
  )

  const refreshNow = useCallback((): Promise<boolean> => {
    if (inFlightRefreshRef.current) return inFlightRefreshRef.current

    const attempt = (async () => {
      try {
        const result = await withRefreshLock(refreshRequest)
        applySuccessfulAuth(result)
        return true
      } catch {
        return false
      } finally {
        inFlightRefreshRef.current = null
      }
    })()

    inFlightRefreshRef.current = attempt
    return attempt
  }, [applySuccessfulAuth])

  refreshNowRef.current = refreshNow

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await loginRequest({ email, password })
      applySuccessfulAuth(result)
      setNotice(null)
    },
    [applySuccessfulAuth],
  )

  const logout = useCallback(() => {
    // Best-effort: local state clears regardless of whether this succeeds.
    void logoutRequest().catch(() => undefined)
    clearTimers()
    setAccessToken(null)
    setSession(null)
    setIdleWarningVisible(false)
    setNotice('signed-out')
  }, [clearTimers])

  const applyUserUpdate = useCallback((user: UserSummary) => {
    setSession((prev) => (prev ? { ...prev, user } : prev))
  }, [])

  const dismissRoleChangeNotice = useCallback(() => setRoleChangeNotice(null), [])

  const staySignedIn = useCallback(() => {
    activityRef.current = Date.now()
    setIdleWarningVisible(false)
    void refreshNow()
  }, [refreshNow])

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

  // Silent restore on mount (ADR 0012): the httpOnly refresh cookie, if
  // there's a valid one, mints a fresh access token without ever showing
  // the login page.
  useEffect(() => {
    if (initialSession) return
    let cancelled = false
    void refreshNow().finally(() => {
      if (!cancelled) setCheckingInitialSession(false)
    })
    return () => {
      cancelled = true
    }
    // Deliberately mount-only: re-running this on a later `refreshNow`
    // identity change would mean attempting the restore again, which only
    // ever makes sense once, right when the app first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A 401 on an authenticated request means a refresh was tried (by
  // api/client.ts, via setRefreshHandler below) and didn't help - the
  // session is really over. Drop it and send them to log in, instead of
  // leaving a broken page. A layout effect, so it's registered before any
  // child's data-fetching effect runs.
  useLayoutEffect(() => {
    setSessionEndedHandler(() => {
      // Nothing to end if nobody is logged in (a stray 401 must not raise a notice).
      if (!hasAccessToken()) return
      clearTimers()
      setAccessToken(null)
      setSession(null)
      setIdleWarningVisible(false)
      setNotice('expired')
    })
    setForbiddenHandler(() => {
      void resync()
    })
    setRefreshHandler(() => refreshNow())
    return () => {
      setSessionEndedHandler(null)
      setForbiddenHandler(null)
      setRefreshHandler(null)
    }
  }, [resync, refreshNow, clearTimers])

  useEffect(() => {
    function onFocus() {
      // A backgrounded tab's timers can be throttled by the browser, so a
      // proactive refresh may never have fired - treat regaining focus as
      // activity too, not just a cue to check for a role change.
      activityRef.current = Date.now()
      void resync()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [resync])

  useEffect(() => {
    function markActive() {
      activityRef.current = Date.now()
    }
    window.addEventListener('click', markActive)
    window.addEventListener('keydown', markActive)
    window.addEventListener('popstate', markActive)
    return () => {
      window.removeEventListener('click', markActive)
      window.removeEventListener('keydown', markActive)
      window.removeEventListener('popstate', markActive)
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      notice,
      roleChangeNotice,
      dismissRoleChangeNotice,
      login,
      logout,
      applyUserUpdate,
      idleWarningVisible,
      staySignedIn,
    }),
    [
      session,
      notice,
      roleChangeNotice,
      dismissRoleChangeNotice,
      login,
      logout,
      applyUserUpdate,
      idleWarningVisible,
      staySignedIn,
    ],
  )

  if (checkingInitialSession) {
    return null
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
