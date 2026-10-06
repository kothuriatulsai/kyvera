import { useState, type FormEvent } from 'react'
import { USER_ROLES, type UserRole } from '@kyvera/shared-types'
import { ApiError } from '../api/client'
import { createUser } from '../api/users'

interface NewUserFormProps {
  /** The page just refetches the list; the created user's own data isn't needed here. */
  onCreated: () => void
}

/** ADMIN-only: creates an account with a temporary password (ADR 0010/0011 - there's no self-registration). */
export function NewUserForm({ onCreated }: NewUserFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('FINANCE')
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedName = name.trim()
  const trimmedEmail = email.trim()
  const canSubmit = trimmedName !== '' && trimmedEmail !== '' && temporaryPassword !== '' && !submitting

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)
    try {
      await createUser({ name: trimmedName, email: trimmedEmail, role, temporaryPassword })
      setName('')
      setEmail('')
      setRole('FINANCE')
      setTemporaryPassword('')
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="control" onSubmit={handleSubmit}>
      <h3>New user</h3>
      <label>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label>
        Temporary password
        <input
          type="text"
          value={temporaryPassword}
          onChange={(e) => setTemporaryPassword(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={!canSubmit}>
        {submitting ? 'Creating…' : 'Create user'}
      </button>
    </form>
  )
}
