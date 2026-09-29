import { useState } from 'react'
import type { TransitionRequest } from '@kyvera/shared-types'
import type { SignOff, StagePosition } from '../lib/transitions'
import { ForceConfirmation } from './ForceConfirmation'

interface AdvanceControlProps {
  position: StagePosition
  signOff: SignOff
  busy: boolean
  run: (body: TransitionRequest) => Promise<boolean>
}

/**
 * Moves the product one stage forward. When the current stage has several
 * assignees who haven't all signed off, the same button becomes "Force advance" and
 * asks first; `force: true` is only ever sent from that confirmed path. A normal
 * advance sends no force flag at all.
 */
export function AdvanceControl({ position, signOff, busy, run }: AdvanceControlProps) {
  const [confirming, setConfirming] = useState(false)
  if (!position.next || !position.current) return null

  async function forceAdvance() {
    await run({ force: true })
    setConfirming(false)
  }

  return (
    <div className="control">
      <h3>Advance</h3>
      <p className="muted">Moves the product forward to {position.next.name}.</p>

      {confirming ? (
        <ForceConfirmation
          signOff={signOff}
          stageName={position.current.name}
          confirmLabel="force advance"
          busy={busy}
          onConfirm={forceAdvance}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => (signOff.needsForce ? setConfirming(true) : void run({}))}
        >
          {signOff.needsForce ? 'Force advance' : 'Advance'}
        </button>
      )}
    </div>
  )
}
