import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { setAccessToken, setSessionEndedHandler } from '../api/client'

// The token and the session-ended handler are module-level state (by design: the
// token lives in memory). Reset them so one test can't leak a login into the next.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setAccessToken(null)
  setSessionEndedHandler(null)
})
