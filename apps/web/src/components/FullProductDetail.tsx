import type {
  ProductDelay,
  ProductDetail,
  StageDefinition,
  StageProgress,
} from '@kyvera/shared-types'
import { formatDate, formatDays } from '../lib/format'
import { historyOutcomes, OUTCOME_LABELS } from '../lib/history'
import { AssigneesCell } from './AssigneesCell'
import { ProductActions } from './ProductActions'
import { StatusBadge } from './StatusBadge'

const PROGRESS_LABELS: Record<StageProgress, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  not_started: 'Not started',
  // Visited, then left by moving the product backward: it has to be done again.
  sent_back: 'Sent back',
}

interface FullProductDetailProps {
  product: ProductDetail
  delay: ProductDelay
  stages: StageDefinition[]
  /** Reload the page's data after an action. */
  onChanged: () => Promise<void>
}

/** A product as an admin, its owner or an assigned manager sees it: all of it. */
export function FullProductDetail({ product, delay, stages, onChanged }: FullProductDetailProps) {
  const delayByOrder = new Map(delay.stages.map((s) => [s.sequenceOrder, s]))
  const outcomes = historyOutcomes(product.stageHistory)

  // Who is assigned to each stage. These are the *current* assignments: the API
  // doesn't keep who was assigned at the time of an earlier visit.
  const assigneesOf = (stageId: string) =>
    product.assignments.filter((a) => a.stageId === stageId).map((a) => a.user)

  return (
    <>
      <header className="detail-header">
        <h1>{product.name}</h1>
        <StatusBadge status={product.status} />
      </header>
      {product.description && <p>{product.description}</p>}

      <dl className="facts">
        <div>
          <dt>Owner</dt>
          <dd>{product.owner.name}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>v{product.currentVersion}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatDate(product.startDate)}</dd>
        </div>
        <div>
          <dt>Projected completion</dt>
          <dd>{formatDate(delay.expectedCompletionDate)}</dd>
        </div>
        <div>
          <dt>Total delay</dt>
          <dd>{formatDays(delay.totalDelayDays)}</dd>
        </div>
      </dl>

      {/* Keyed by stage: once the product moves, the controls start fresh (no
          half-typed reason or chosen decision carried over to the new stage). */}
      <ProductActions
        key={product.currentStageId ?? 'none'}
        product={product}
        stages={stages}
        onChanged={onChanged}
      />

      <h2>Timeline</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Stage</th>
            <th>Progress</th>
            <th>Duration</th>
            <th>Expected</th>
            <th>Delay</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => {
            const result = delayByOrder.get(stage.sequenceOrder)
            const isCurrent = stage.id === product.currentStageId
            return (
              <tr key={stage.id} className={isCurrent ? 'current' : undefined}>
                <td>{stage.sequenceOrder}</td>
                <td>{stage.name}</td>
                <td>{result ? PROGRESS_LABELS[result.status] : '—'}</td>
                <td>{result ? formatDays(result.durationDays) : '—'}</td>
                <td>{formatDays(stage.expectedDurationDays)}</td>
                <td className={result?.delayed ? 'delay' : undefined}>
                  {result?.delayed ? `+${formatDays(result.delayDays)}` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h2>Assignments</h2>
      {product.assignments.length === 0 ? (
        <p className="muted">Nobody is assigned to a stage of this product yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Assignee</th>
              <th>Ready</th>
            </tr>
          </thead>
          <tbody>
            {product.assignments.map((assignment) => (
              <tr key={assignment.id}>
                <td>{assignment.stage.name}</td>
                <td>{assignment.user.name}</td>
                <td>{assignment.readyAt ? formatDate(assignment.readyAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Progress notes</h2>
      {product.progressNotes.length === 0 ? (
        <p className="muted">No progress notes yet.</p>
      ) : (
        <ul className="notes">
          {product.progressNotes.map((note) => (
            <li key={note.id}>
              <p>{note.note}</p>
              <span className="muted">
                {stages.find((s) => s.id === note.stageId)?.name ?? 'A stage'} · {note.user.name} ·{' '}
                {formatDate(note.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2>Approvals</h2>
      {product.approvals.length === 0 ? (
        <p className="muted">No approval decisions yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Decision</th>
              <th>Version</th>
              <th>Decided by</th>
              <th>When</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {product.approvals.map((approval) => (
              <tr key={approval.id}>
                <td>{approval.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</td>
                <td>v{approval.productVersion.versionNumber}</td>
                <td>{approval.decidedBy.name}</td>
                <td>{formatDate(approval.decidedAt)}</td>
                <td>{approval.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Stage history</h2>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Entered</th>
            <th>Exited</th>
            <th>Outcome</th>
            <th>Responsible</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {product.stageHistory.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.stage.name}</td>
              <td>{formatDate(entry.enteredAt)}</td>
              <td>{entry.exitedAt ? formatDate(entry.exitedAt) : '—'}</td>
              <td>{OUTCOME_LABELS[outcomes.get(entry.id) ?? 'completed']}</td>
              <td>
                <AssigneesCell
                  stageName={entry.stage.name}
                  assignees={assigneesOf(entry.stageId)}
                  fallback={entry.responsibleUser}
                />
              </td>
              <td>
                {entry.delayReason ?? ''}
                {entry.forcedExit ? ' (advanced without every sign-off)' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Versions</h2>
      <ul className="versions">
        {product.versions.map((version) => (
          <li key={version.id}>
            <strong>v{version.versionNumber}</strong>{' '}
            <span className="muted">
              {formatDate(version.createdAt)} · {version.createdBy.name}
            </span>
            {version.spec && <p>{version.spec}</p>}
          </li>
        ))}
      </ul>
    </>
  )
}
