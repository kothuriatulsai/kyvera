import { useCallback, useEffect, useRef, useState } from 'react'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T }

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}

/**
 * Runs `load` on mount and whenever `key` changes. `key` identifies the
 * request (e.g. a route param); a result only counts if it belongs to the
 * current key, so a stale response can never render as the current one.
 *
 * `reload` fetches again *without* going back to "loading", so the page stays
 * mounted (and keeps any form state or inline error) while fresh data arrives.
 */
export function useAsyncWithReload<T>(load: () => Promise<T>, key = '') {
  const [settled, setSettled] = useState<{ key: string; state: AsyncState<T> } | null>(null)

  // `reload` is called long after the render that created it; keep the latest loader.
  const latestLoad = useRef(load)
  useEffect(() => {
    latestLoad.current = load
  })

  useEffect(() => {
    let cancelled = false

    load().then(
      (data) => {
        if (!cancelled) setSettled({ key, state: { status: 'success', data } })
      },
      (err: unknown) => {
        if (!cancelled) setSettled({ key, state: { status: 'error', message: messageOf(err) } })
      },
    )

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies `load`'s inputs
  }, [key])

  const reload = useCallback(async () => {
    try {
      const data = await latestLoad.current()
      setSettled({ key, state: { status: 'success', data } })
    } catch (err) {
      setSettled({ key, state: { status: 'error', message: messageOf(err) } })
    }
  }, [key])

  const state: AsyncState<T> = settled?.key === key ? settled.state : { status: 'loading' }
  return { state, reload }
}

export function useAsync<T>(load: () => Promise<T>, key = ''): AsyncState<T> {
  return useAsyncWithReload(load, key).state
}
