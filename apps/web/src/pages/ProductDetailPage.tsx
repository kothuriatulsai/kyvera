import type { StageProgress } from '@kyvera/shared-types'
import { Link, useParams } from 'react-router'
import { fetchProduct, fetchProductDelay, fetchStages } from '../api/products'
import { AsyncView } from '../components/AsyncView'
import { StatusBadge } from '../components/StatusBadge'
import { useAsync } from '../hooks/useAsync'
import { formatDate, formatDays } from '../lib/format'

const PROGRESS_LABELS: Record<StageProgress, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  not_started: 'Not started',
}

export function ProductDetailPage() {
  const { id = '' } = useParams()

  const state = useAsync(async () => {
    const [product, delay, stages] = await Promise.all([
      fetchProduct(id),
      fetchProductDelay(id),
      fetchStages(),
    ])
    return { product, delay, stages }
  }, id)

  return (
    <section>
      <p>
        <Link to="/">← All products</Link>
      </p>
      <AsyncView state={state}>
        {({ product, delay, stages }) => {
          // The assignee view (only your own stages) gets its own UI in the
          // frontend session; this page renders the full view.
          if (product.view !== 'full' || delay.view !== 'full') {
            return (
              <p className="muted">
                You're assigned to part of this product. The assignee view isn't built yet.
              </p>
            )
          }

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
                      <td>{entry.delayReason ?? ''}</td>
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
        }}
      </AsyncView>
    </section>
  )
}
