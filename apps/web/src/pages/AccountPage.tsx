import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { changePassword } from '../api/auth'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/useAuth'

/**
 * Any logged-in user's own account page: profile summary and a change-
 * password form (ADR 0011). The one screen reachable even while
 * `mustChangePassword` is set - see RequireAuth - so it also carries that
 * notice when it applies.
 */
export function AccountPage() {
  const { session, applyUserUpdate } = useAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!session) return null
  const { user } = session
  const canSubmit = currentPassword !== '' && newPassword !== '' && !submitting

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)
    try {
      const updated = await changePassword({ currentPassword, newPassword })
      applyUserUpdate(updated)
      setCurrentPassword('')
      setNewPassword('')
      if (user.mustChangePassword) {
        navigate('/', { replace: true })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section>
      <h1>My account</h1>

      <dl className="facts">
        <div>
          <dt>Name</dt>
          <dd>{user.name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{user.role}</dd>
        </div>
      </dl>

      {user.mustChangePassword && (
        <p className="notice">
          An admin reset your password. You must set a new one before you can do anything else.
        </p>
      )}

      <form className="control" onSubmit={handleSubmit}>
        <h3>Change password</h3>
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" disabled={!canSubmit}>
          {submitting ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </section>
  )
}
