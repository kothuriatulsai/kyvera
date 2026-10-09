import { useState } from 'react'
import { USER_ROLES, type ProjectMembership, type UserRole, type UserSummary } from '@kyvera/shared-types'
import { ApiError } from '../api/client'
import { changeUserRole, deactivateUser, fetchProjectsForUser, reactivateUser, resetPassword } from '../api/users'
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

  const [pendingRole, setPendingRole] = useState<UserRole>(user.role)
  const [confirmingRole, setConfirmingRole] = useState(false)
  // Keeps the select in sync if this row's role changed some other way
  // (another admin, a different tab) while this one wasn't mid-edit -
  // adjusted during render rather than in an effect, per React's own
  // guidance for "reset state when a prop changes".
  const [lastSeenRole, setLastSeenRole] = useState(user.role)
  if (user.role !== lastSeenRole) {
    setLastSeenRole(user.role)
    setPendingRole(user.role)
  }

  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null)

  const [projects, setProjects] = useState<ProjectMembership[] | null>(null)
  const [projectsError, setProjectsError] = useState<string | null>(null)

  async function handleToggleProjects() {
    if (projects !== null) {
      setProjects(null)
      return
    }
    setProjectsError(null)
    try {
      setProjects(await fetchProjectsForUser(user.id))
    } catch (err) {
      setProjectsError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    }
  }

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

  async function handleConfirmRoleChange() {
    await run(() => changeUserRole(user.id, { role: pendingRole }))
    setConfirmingRole(false)
  }

  async function handleReset() {
    setBusy(true)
    setError(null)
    try {
      const result = await resetPassword(user.id)
      setTemporaryPassword(result.temporaryPassword)
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr>
      <td>{user.name}</td>
      <td>{user.email}</td>
      <td>
        <select
          value={pendingRole}
          disabled={busy}
          onChange={(e) => setPendingRole(e.target.value as UserRole)}
        >
          {USER_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || pendingRole === user.role}
          onClick={() => setConfirmingRole(true)}
        >
          Change
        </button>
        {confirmingRole && (
          <span className="control">
            <p>
              Change {user.name}&rsquo;s role to {pendingRole}?
            </p>
            <button type="button" disabled={busy} onClick={handleConfirmRoleChange}>
              Confirm
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmingRole(false)
                setPendingRole(user.role)
              }}
            >
              Cancel
            </button>
          </span>
        )}
      </td>
      <td>{user.isActive ? 'Active' : 'Inactive'}</td>
      <td>{formatDate(user.createdAt)}</td>
      <td>
        <button type="button" onClick={handleToggleProjects}>
          {projects === null ? 'Show' : 'Hide'}
        </button>
        {projectsError && (
          <p role="alert" className="error">
            {projectsError}
          </p>
        )}
        {projects !== null && (
          <ul>
            {projects.length === 0 ? (
              <li className="muted">No projects</li>
            ) : (
              projects.map((membership) => <li key={membership.id}>{membership.project.code}</li>)
            )}
          </ul>
        )}
      </td>
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
        {temporaryPassword ? (
          <span className="control">
            <p>
              Temporary password: <code>{temporaryPassword}</code>
            </p>
            <p className="muted">Make a note of it now - it won&rsquo;t be shown again.</p>
            <button type="button" onClick={() => setTemporaryPassword(null)}>
              Done
            </button>
          </span>
        ) : (
          <button type="button" disabled={busy} onClick={handleReset}>
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
