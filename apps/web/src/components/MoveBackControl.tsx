import { useState, type FormEvent } from 'react'
import type { TransitionRequest } from '@kyvera/shared-types'
import type { StagePosition } from '../lib/transitions'

interface MoveBackControlProps {
  position: StagePosition
  busy: boolean
  run: (body: TransitionRequest) => Promise<boolean>
}

/**
 * Sends the product back one stage. A reason is required, so the button stays
 * disabled until there is one - the user is never sent to the server to be told off
 * for an empty field. (The server still checks: this is a courtesy, not the rule.)
 */
export function MoveBackControl({ position, busy, run }: MoveBackControlProps) {
  const [reason, setReason] = useState('')
  if (!position.previous) return null

  const trimmed = reason.trim()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (trimmed === '') return
    void run({ direction: 'backward', reason: trimmed })
  }

  return (
    <form className="control" onSubmit={submit}>
      <h3>Move back</h3>
      <p className="muted">
        Sends the product back to {position.previous.name}. Sign-offs on that stage start again,
        and your reason is recorded.
      </p>
      <label>
        Reason for moving back
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" disabled={busy || trimmed === ''}>
        Move back
      </button>
    </form>
  )
}
