import { Link } from 'react-router'
import { AsyncView } from '../components/AsyncView'
import { useProductsWithDelays } from '../hooks/useProductsWithDelays'
import { formatDate, formatDays } from '../lib/format'

export function DelayedPage() {
  const state = useProductsWithDelays()

  return (
    <section>
      <h1>Delayed products</h1>
      <AsyncView state={state}>
        {(rows) => {
          const delayed = rows
            .filter((row) => row.status === 'DELAYED')
            .sort((a, b) => (b.delay?.totalDelayDays ?? 0) - (a.delay?.totalDelayDays ?? 0))

          if (delayed.length === 0) {
            return <p className="muted">Nothing is delayed right now.</p>
          }

          return (
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Stage</th>
                  <th>Owner</th>
                  <th>Total delay</th>
                  <th>Projected completion</th>
                </tr>
              </thead>
              <tbody>
                {delayed.map(({ product, delay }) => (
                  <tr key={product.id}>
                    <td>
                      <Link to={`/products/${product.id}`}>{product.name}</Link>
                    </td>
                    <td>{product.currentStage?.name ?? '—'}</td>
                    <td>{product.owner.name}</td>
                    <td>{delay ? formatDays(delay.totalDelayDays) : '—'}</td>
                    <td>{formatDate(delay?.expectedCompletionDate ?? product.expectedCompletionDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }}
      </AsyncView>
    </section>
  )
}
