import type {
  ProductDelay,
  ProductDetail,
  StageDefinition,
  StageProgress,
} from '@kyvera/shared-types'
import { formatDate, formatDays } from '../lib/format'
import { StatusBadge } from './StatusBadge'

const PROGRESS_LABELS: Record<StageProgress, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  not_started: 'Not started',
}

interface FullProductDetailProps {
  product: ProductDetail
  delay: ProductDelay
  stages: StageDefinition[]
}

/** A product as an admin, its owner or an assigned manager sees it: all of it. */
export function FullProductDetail({ product, delay, stages }: FullProductDetailProps) {
  const delayByOrder = new Map(delay.stages.map((s) => [s.sequenceOrder, s]))

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

      <h2>Stage history</h2>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Entered</th>
            <th>Exited</th>
            <th>Responsible</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {product.stageHistory.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.stage.name}</td>
              <td>{formatDate(entry.enteredAt)}</td>
              <td>{entry.exitedAt ? formatDate(entry.exitedAt) : 'Current'}</td>
              <td>{entry.responsibleUser?.name ?? '—'}</td>
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
