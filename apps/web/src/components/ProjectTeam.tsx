import { useState } from 'react'
import type { ProjectMember, UserSummary } from '@kyvera/shared-types'
import { ApiError } from '../api/client'
import { addProjectMember, fetchMembershipCandidates, fetchProjectMembers, removeProjectMember } from '../api/projects'
import { useAsyncWithReload } from '../hooks/useAsync'
import { AsyncView } from './AsyncView'

interface ProjectTeamProps {
  projectId: string
  /** PMO/ADMIN only - see lib/sopPermissions.ts's `canManageMembers`. */
  canManage: boolean
}

/** Layer A of ADR 0013, shown on a Project's detail page: who is a member
 * (visible to anyone who can see the Project at all), and - for PMO/ADMIN -
 * controls to add or remove one. */
export function ProjectTeam({ projectId, canManage }: ProjectTeamProps) {
  const { state, reload } = useAsyncWithReload(() => fetchProjectMembers(projectId), projectId)

  return (
    <section>
      <h2>Team</h2>
      <AsyncView state={state}>
        {(members) =>
          members.length === 0 ? (
            <p className="muted">No members yet.</p>
          ) : (
            <ul>
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  projectId={projectId}
                  member={member}
                  canManage={canManage}
                  onChanged={reload}
                />
              ))}
            </ul>
          )
        }
      </AsyncView>
      {canManage && <AddMemberControl projectId={projectId} onAdded={reload} />}
    </section>
  )
}

function MemberRow({
  projectId,
  member,
  canManage,
  onChanged,
}: {
  projectId: string
  member: ProjectMember
  canManage: boolean
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRemove() {
    setBusy(true)
    setError(null)
    try {
      await removeProjectMember(projectId, member.userId)
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <li>
      {member.user.name} <span className="muted">({member.user.role.toLowerCase()})</span>
      {canManage && (
        <>
          {' '}
          <button type="button" disabled={busy} onClick={handleRemove}>
            Remove
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </li>
  )
}

function AddMemberControl({ projectId, onAdded }: { projectId: string; onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<UserSummary[] | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleOpen() {
    setOpen(true)
    setError(null)
    try {
      const result = await fetchMembershipCandidates(projectId)
      setCandidates(result)
      setSelectedId(result[0]?.id ?? '')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    }
  }

  async function handleAdd() {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    try {
      await addProjectMember(projectId, { userId: selectedId })
      await onAdded()
      setOpen(false)
      setCandidates(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={handleOpen}>
        Add a member
      </button>
    )
  }

  return (
    <div className="control">
      <h3>Add a member</h3>
      {candidates === null ? (
        <p className="muted">Loading…</p>
      ) : candidates.length === 0 ? (
        <p className="muted">No eligible users to add.</p>
      ) : (
        <>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {candidates.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.role.toLowerCase()})
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={handleAdd}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setOpen(false)
          setCandidates(null)
        }}
      >
        Cancel
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  )
}
