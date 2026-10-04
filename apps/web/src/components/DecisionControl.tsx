import { useState, type FormEvent } from 'react'
import type { ApprovalDecision, DecideTechPackVersionResponse } from '@kyvera/shared-types'
import { ApiError } from '../api/client'
import { decideTechPackVersion } from '../api/techPacks'

interface DecisionControlProps {
  techPackId: string
  versionNumber: number
  /** Reports the full response up to the parent on success, which shows the
   * outcome (link to the new Proto Request, or to the successor TechPack) -
   * not here, since the parent's own reload (see `onChanged`) can make this
   * control stop being shown at all (once decided, `canDecide` is false)
   * before a result rendered *in* this component would ever be seen. */
  onDecided: (response: DecideTechPackVersionResponse) => Promise<void>
  /** Reload the page's data after a failed attempt - a 409 usually means the
   * TechPack's state changed underneath (a concurrent upload, say). */
  onChanged: () => Promise<void>
}

/** MANAGEMENT's Approve/Reject on the confirmed, latest version. Shown only
 * once Engineering has confirmed it - see lib/sopPermissions.ts's canDecide. */
export function DecisionControl({ techPackId, versionNumber, onDecided, onChanged }: DecisionControlProps) {
  const [decision, setDecision] = useState<ApprovalDecision | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = notes.trim()
  const rejectingWithoutNotes = decision === 'REJECTED' && trimmed === ''
  const canSubmit = decision !== null && !rejectingWithoutNotes && !submitting

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit || decision === null) return

    setSubmitting(true)
    setError(null)
    try {
      const response = await decideTechPackVersion(techPackId, versionNumber, {
        decision,
        ...(trimmed !== '' ? { notes: trimmed } : {}),
      })
      await onDecided(response)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      await onChanged()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="control" onSubmit={handleSubmit}>
      <h3>Decision</h3>
      <p className="muted">Decides v{versionNumber}, now that Engineering has confirmed it.</p>

      <fieldset>
        <legend>Decision</legend>
        <label className="choice">
          <input
            type="radio"
            name="decision"
            checked={decision === 'APPROVED'}
            onChange={() => setDecision('APPROVED')}
          />
          Approved
        </label>
        <label className="choice">
          <input
            type="radio"
            name="decision"
            checked={decision === 'REJECTED'}
            onChange={() => setDecision('REJECTED')}
          />
          Rejected
        </label>
      </fieldset>

      <ul className="consequences">
        <li>
          <strong>Approved</strong> creates a Proto Request pinned to v{versionNumber}.
        </li>
        <li>
          <strong>Rejected</strong> voids this Tech Pack and starts a new one under the same Project, using your
          notes as the reason.
        </li>
      </ul>

      <label>
        Notes
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p className="muted">Optional when approving. Required when rejecting.</p>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <button type="submit" disabled={!canSubmit}>
        {decision === 'APPROVED' ? 'Approve' : decision === 'REJECTED' ? 'Reject' : 'Submit decision'}
      </button>
    </form>
  )
}
