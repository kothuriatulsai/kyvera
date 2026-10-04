import { useState } from 'react'
import { Link } from 'react-router'
import type { DecideTechPackVersionResponse, TechPackDetail } from '@kyvera/shared-types'
import { useAuth } from '../auth/useAuth'
import { canConfirm, canDecide, canUploadVersion } from '../lib/sopPermissions'
import { ConfirmControl } from './ConfirmControl'
import { DecisionControl } from './DecisionControl'
import { UploadVersionControl } from './UploadVersionControl'

interface TechPackActionsProps {
  techPack: TechPackDetail
  /** Reload the page's data after something changed (or failed). */
  onChanged: () => Promise<void>
}

/**
 * What someone with the right role can do to a (non-voided) TechPack: upload
 * a new version, confirm the latest one, or decide it. Each control decides
 * for itself whether it applies (see lib/sopPermissions.ts) - this component
 * just renders whichever ones do, and nothing at all if none do, so a role
 * with no TechPack actions (FINANCE, say) sees no empty "Actions" heading.
 *
 * There is no separate permission check beyond those functions, on purpose:
 * the server enforces all of this regardless (ADR 0007/0009); hiding a
 * control is courtesy, not security - same reasoning `ProductActions` already
 * gives for the old module.
 */
export function TechPackActions({ techPack, onChanged }: TechPackActionsProps) {
  const { session } = useAuth()
  // The one result that must survive this component's own re-render after
  // `onChanged()` reloads fresh data: once a version is decided, `canDecide`
  // turns false and `DecisionControl` stops rendering, so the outcome (link
  // to the new Proto Request, or to the rejection's successor TechPack) has
  // to live here, not inside that control.
  const [lastDecision, setLastDecision] = useState<DecideTechPackVersionResponse | null>(null)

  if (!session) return null
  const role = session.user.role
  const latest = techPack.versions[0]

  const showUpload = canUploadVersion(role, techPack)
  const showConfirm = latest !== undefined && canConfirm(role, techPack, latest)
  const showDecide = latest !== undefined && canDecide(role, techPack, latest)

  if (!showUpload && !showConfirm && !showDecide && !lastDecision) return null

  async function handleDecided(response: DecideTechPackVersionResponse) {
    setLastDecision(response)
    await onChanged()
  }

  return (
    <section className="actions-panel" aria-labelledby="actions-heading">
      <h2 id="actions-heading">Actions</h2>

      {lastDecision && (
        <div className="control">
          <h3>Decision recorded</h3>
          {lastDecision.decision === 'APPROVED' ? (
            <p>
              Approved.{' '}
              <Link to={`/proto-requests/${lastDecision.protoRequest?.id}`}>
                View {lastDecision.protoRequest?.code}
              </Link>
              .
            </p>
          ) : (
            <p>
              Voided — continue on{' '}
              <Link to={`/tech-packs/${lastDecision.techPack.id}`}>{lastDecision.techPack.code}</Link>.
            </p>
          )}
        </div>
      )}

      {showUpload && (
        <UploadVersionControl
          techPackId={techPack.id}
          nextVersionNumber={(latest?.versionNumber ?? 0) + 1}
          onChanged={onChanged}
        />
      )}
      {showConfirm && latest && (
        <ConfirmControl techPackId={techPack.id} versionNumber={latest.versionNumber} onChanged={onChanged} />
      )}
      {showDecide && latest && (
        <DecisionControl
          techPackId={techPack.id}
          versionNumber={latest.versionNumber}
          onDecided={handleDecided}
          onChanged={onChanged}
        />
      )}
    </section>
  )
}
