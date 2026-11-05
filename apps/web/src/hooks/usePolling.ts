import { useEffect, useRef } from 'react'

/**
 * Calls `fn` immediately and then every `intervalMs`, but only while the tab
 * is visible - paused on `document.visibilitychange` away from 'visible',
 * resumed (with an immediate call) on return. A standalone primitive,
 * deliberately not part of `AuthProvider`'s own one-shot timers (ADR 0012
 * states nothing else in this app polls on a timer) - this is the one
 * exception, scoped to badge counts (ADR 0014), and must never mark user
 * activity or otherwise touch the auth/idle-timeout machinery.
 */
export function usePolling(fn: () => void, intervalMs: number) {
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null

    function start() {
      if (id !== null) return
      fnRef.current()
      id = setInterval(() => fnRef.current(), intervalMs)
    }

    function stop() {
      if (id === null) return
      clearInterval(id)
      id = null
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalMs])
}
