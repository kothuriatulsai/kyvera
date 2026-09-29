import type { ProductDetail, StageDefinition, TransitionRequest } from '@kyvera/shared-types'
import { useState } from 'react'
import { ApiError } from '../api/client'
import { transitionProduct } from '../api/products'
import { currentStageSignOff, stagePosition } from '../lib/transitions'
import { AdvanceControl } from './AdvanceControl'
import { ApprovalControl } from './ApprovalControl'
import { MoveBackControl } from './MoveBackControl'

interface ProductActionsProps {
  product: ProductDetail
  stages: StageDefinition[]
  /** Reload the page's data after something changed (or failed). */
  onChanged: () => Promise<void>
}

/**
 * What someone with authority over a product can do to it: advance (or force),
 * move back, and decide an approval.
 *
 * There is no separate permission check here, on purpose. The API returns
 * `view: "full"` to exactly the people who hold authority over a product (admin,
 * owner, assigned manager) and this component is only ever rendered for that view.
 * An assignee gets the assignee view, which has no such controls, and a user with no
 * tie to the product gets a 404 and no page at all. The server enforces all of it
 * regardless; hiding the buttons is courtesy, not security.
 */
export function ProductActions({ product, stages, onChanged }: ProductActionsProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const position = stagePosition(product.currentStageId, stages)
  const signOff = currentStageSignOff(product)

  /** Runs one transition. On failure, shows the API's reason and refreshes what we show. */
  async function run(body: TransitionRequest): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await transitionProduct(product.id, body)
      await onChanged()
      return true
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      // A 409 usually means sign-offs changed since this page loaded: refresh them.
      await onChanged()
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="actions-panel" aria-labelledby="actions-heading">
      <h2 id="actions-heading">Actions</h2>

      {position.current && (
        <p className="muted">
          Currently in {position.current.name}.{' '}
          {signOff.total === 0
            ? 'Nobody is assigned to this stage.'
            : `${signOff.signedOff} of ${signOff.total} assignees have signed off.`}
        </p>
      )}

      {position.atFinal ? (
        <p className="muted">This is the final stage, so there is nothing to advance to.</p>
      ) : position.enteringFinal ? (
        <ApprovalControl
          position={position}
          signOff={signOff}
          version={product.currentVersion}
          busy={busy}
          run={run}
        />
      ) : (
        <AdvanceControl position={position} signOff={signOff} busy={busy} run={run} />
      )}

      <MoveBackControl position={position} busy={busy} run={run} />

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  )
}
