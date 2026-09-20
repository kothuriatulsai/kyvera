import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import App from '../App'
import type { Session } from '../auth/authContext'
import { AuthProvider } from '../auth/AuthProvider'

/** Renders the whole app at `path`, optionally already logged in. */
export function renderApp(path = '/', options: { session?: Session } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialSession={options.session}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}
