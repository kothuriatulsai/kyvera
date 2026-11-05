import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePolling } from './usePolling'

/** Stubs `document.visibilityState` so tests can flip it and dispatch the
 * real event the hook listens for - jsdom's own value isn't settable. */
function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls fn immediately, then again every interval, while visible', () => {
    const fn = vi.fn()
    renderHook(() => usePolling(fn, 60_000))

    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60_000)
    expect(fn).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(120_000)
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('stops polling while the tab is hidden, and resumes (with an immediate call) when visible again', () => {
    const fn = vi.fn()
    renderHook(() => usePolling(fn, 60_000))
    expect(fn).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    vi.advanceTimersByTime(180_000)
    expect(fn).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    expect(fn).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(60_000)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('stops entirely on unmount', () => {
    const fn = vi.fn()
    const { unmount } = renderHook(() => usePolling(fn, 60_000))
    expect(fn).toHaveBeenCalledTimes(1)

    unmount()
    vi.advanceTimersByTime(600_000)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('always calls the latest fn, not the one from the first render', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ fn }) => usePolling(fn, 60_000), { initialProps: { fn: first } })
    expect(first).toHaveBeenCalledTimes(1)

    rerender({ fn: second })
    vi.advanceTimersByTime(60_000)

    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
  })
})
