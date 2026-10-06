import { useState } from 'react'
import { USER_ROLES, type UserRole, type UserSummary } from '@kyvera/shared-types'
import { ApiError } from '../api/client'
import { changeUserRole, deactivateUser, reactivateUser, resetPassword } from '../api/users'
import { formatDate } from '../lib/format'

interface UserRowProps {
  user: UserSummary
  onChanged: () => Promise<void>
}

/** One row of the Users table, with its role/active/password controls. Every
 * action is admin-only server-side; this just gives the admin something to click. */
export function UserRow({ user, onChanged }: UserRowProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [newPassword, setNewPassword] = useState('')

  async function run(action: () => Promise<UserSummary>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleResetSubmit() {
    if (newPassword === '') return
    await run(() => resetPassword(user.id, { password: newPassword }))
    setNewPassword('')
    setResetting(false)
  }

  return (
    <tr>
      <td>{user.name}</td>
      <td>{user.email}</td>
      <td>
        <select
          value={user.role}
          disabled={busy}
          onChange={(e) => run(() => changeUserRole(user.id, { role: e.target.value as UserRole }))}
        >
          {USER_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </td>
      <td>{user.isActive ? 'Active' : 'Inactive'}</td>
      <td>{formatDate(user.createdAt)}</td>
      <td className="actions">
        {user.isActive ? (
          <button type="button" disabled={busy} onClick={() => run(() => deactivateUser(user.id))}>
            Deactivate
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => run(() => reactivateUser(user.id))}>
            Reactivate
          </button>
        )}
        {resetting ? (
          <span className="control">
            <input
              type="text"
              aria-label={`New password for ${user.name}`}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button type="button" disabled={busy || newPassword === ''} onClick={handleResetSubmit}>
              Set password
            </button>
            <button type="button" disabled={busy} onClick={() => { setResetting(false); setNewPassword('') }}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" disabled={busy} onClick={() => setResetting(true)}>
            Reset password
          </button>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </td>
    </tr>
  )
}
