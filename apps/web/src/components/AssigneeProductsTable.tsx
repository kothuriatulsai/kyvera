import type { AssigneeProductSummary } from '@kyvera/shared-types'
import { Link } from 'react-router'
import { formatDate, formatDays } from '../lib/format'
import { describeReadiness } from '../lib/readiness'

/**
 * What someone assigned to part of a product sees in a list: their own stage(s)
 * and when they happen. It renders exactly what the API returned and nothing
 * else - no status, owner or dates, because the API withholds them.
 */
export function AssigneeProductsTable({ products }: { products: AssigneeProductSummary[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Product</th>
          <th>Your stage</th>
          <th>When</th>
          <th>Delay</th>
          <th>Ready</th>
        </tr>
      </thead>
      <tbody>
        {products.flatMap((product) =>
          product.stages.map((stage) => (
            <tr key={`${product.id}-${stage.assignmentId}`}>
              <td>
                <Link to={`/products/${product.id}`}>{product.name}</Link>
              </td>
              <td>{stage.stage.name}</td>
              <td>{describeReadiness(stage.readiness)}</td>
              <td className={stage.delay?.delayed ? 'delay' : undefined}>
                {stage.delay?.delayed ? `+${formatDays(stage.delay.delayDays)}` : '—'}
              </td>
              <td>{stage.readyAt ? formatDate(stage.readyAt) : '—'}</td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  )
}
