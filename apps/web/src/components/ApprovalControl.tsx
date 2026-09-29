import { useState, type FormEvent } from 'react'
import type { ApprovalDecision, TransitionRequest } from '@kyvera/shared-types'
import type { SignOff, StagePosition } from '../lib/transitions'
import { ForceConfirmation } from './ForceConfirmation'

interface ApprovalControlProps {
  position: StagePosition
  signOff: SignOff
  version: number
  busy: boolean
  run: (body: TransitionRequest) => Promise<boolean>
}

/**
 * Replaces the plain Advance button one step before the final stage: moving into it
 * needs an approval decision (ADR 0005).
 *
 * Rejecting is not "declining": it is a backward move. The copy says so up front,
 * and it needs notes, which become the reason. Approving moves forward, so it is
 * subject to the same sign-off rule as any advance and asks before overriding it.
 */
export function ApprovalControl({ position, signOff, version, busy, run }: ApprovalControlProps) {
  const [decision, setDecision] = useState<ApprovalDecision | null>(null)
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)

  const gate = position.next // the final (Approval) stage
  if (!gate || !position.current) return null

  const trimmed = notes.trim()
  const rejectingWithoutNotes = decision === 'REJECTED' && trimmed === ''
  // Rejecting sends it back a stage; if there is none, that can't be done.
  const rejectImpossible = decision === 'REJECTED' && position.previous === null
  const canSubmit = decision !== null && !rejectingWithoutNotes && !rejectImpossible && !busy

  const approval = (chosen: ApprovalDecision): TransitionRequest['approval'] =>
    trimmed === '' ? { decision: chosen } : { decision: chosen, notes: trimmed }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit || decision === null) return

    if (decision === 'APPROVED' && signOff.needsForce) {
      setConfirming(true) // ask before overriding sign-off
      return
    }
    void run({ approval: approval(decision) })
  }

  async function approveAnyway() {
    await run({ approval: approval('APPROVED'), force: true })
    setConfirming(false)
  }

  if (confirming) {
    return (
      <div className="control">
        <h3>Approval decision</h3>
        <ForceConfirmation
          signOff={signOff}
          stageName={position.current.name}
          confirmLabel="approval"
          busy={busy}
          onConfirm={approveAnyway}
          onCancel={() => setConfirming(false)}
        />
      </div>
    )
  }

  return (
    <form className="control" onSubmit={submit}>
      <h3>Approval decision</h3>
      <p className="muted">
        The next stage is the approval gate, so this product needs a decision to move on. It is
        recorded against v{version}.
      </p>

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
          <strong>Approved</strong> moves the product forward into {gate.name}.
        </li>
        <li>
          <strong>Rejected</strong> does not just decline it: it moves the product back one stage
          {position.previous ? ` to ${position.previous.name}` : ''}, using your notes as the
          reason. Sign-offs on that stage start again.
        </li>
      </ul>

      <label>
        Notes
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p className="muted">Optional when approving. Required when rejecting.</p>

      <button type="submit" disabled={!canSubmit}>
        {decision === 'APPROVED'
          ? 'Approve'
          : decision === 'REJECTED'
            ? 'Reject and move back'
            : 'Submit decision'}
      </button>
    </form>
  )
}
