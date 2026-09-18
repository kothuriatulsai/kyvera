import type { ReactNode } from 'react'
import type { AsyncState } from '../hooks/useAsync'

interface AsyncViewProps<T> {
  state: AsyncState<T>
  children: (data: T) => ReactNode
}

/** Renders the loading/error states shared by every data-backed page. */
export function AsyncView<T>({ state, children }: AsyncViewProps<T>) {
  if (state.status === 'loading') return <p className="muted">Loading…</p>
  if (state.status === 'error') return <p role="alert" className="error">{state.message}</p>
  return <>{children(state.data)}</>
}
