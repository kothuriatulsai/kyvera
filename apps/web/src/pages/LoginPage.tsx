import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/useAuth'

interface LocationState {
  from?: { pathname: string; search?: string; hash?: string }
}

const NOTICES = {
  expired: 'Your session expired. Please log in again.',
  'signed-out': 'You have been logged out.',
} as const

export function LoginPage() {
  const { session, notice, login } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Back to where they were headed (RequireAuth only records that when it should).
  const from = (location.state as LocationState | null)?.from
  const destination = from ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}` : '/'

  if (session) {
    return <Navigate to={destination} replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate(destination, { replace: true })
    } catch (err) {
      // A wrong password (401) and an unreachable API (status 0) are different
      // problems and must not look alike.
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <section className="login">
      <h1>Log in</h1>
      {notice && <p className="notice">{NOTICES[notice]}</p>}
      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </section>
  )
}
