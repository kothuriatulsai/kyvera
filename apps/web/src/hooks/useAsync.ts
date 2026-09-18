import { useEffect, useState } from 'react'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T }

/**
 * Runs `load` on mount and whenever `key` changes. `key` identifies the
 * request (e.g. a route param); a result only counts if it belongs to the
 * current key, so a stale response can never render as the current one.
 */
export function useAsync<T>(load: () => Promise<T>, key = ''): AsyncState<T> {
  const [settled, setSettled] = useState<{ key: string; state: AsyncState<T> } | null>(null)

  useEffect(() => {
    let cancelled = false

    load().then(
      (data) => {
        if (!cancelled) setSettled({ key, state: { status: 'success', data } })
      },
      (err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Something went wrong'
          setSettled({ key, state: { status: 'error', message } })
        }
      },
    )

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies `load`'s inputs
  }, [key])

  return settled?.key === key ? settled.state : { status: 'loading' }
}
