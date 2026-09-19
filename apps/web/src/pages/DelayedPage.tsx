import { Link } from 'react-router'
import { fetchProducts } from '../api/products'
import { AsyncView } from '../components/AsyncView'
import { useAsync } from '../hooks/useAsync'
import { formatDate, formatDays } from '../lib/format'

export function DelayedPage() {
  const state = useAsync(fetchProducts)

  return (
    <section>
      <h1>Delayed products</h1>
      <AsyncView state={state}>
        {(products) => {
          const delayed = products
            .filter((product) => product.status === 'DELAYED')
            .sort((a, b) => b.delay.totalDelayDays - a.delay.totalDelayDays)

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
                {delayed.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <Link to={`/products/${product.id}`}>{product.name}</Link>
                    </td>
                    <td>{product.currentStage?.name ?? '—'}</td>
                    <td>{product.owner.name}</td>
                    <td>{formatDays(product.delay.totalDelayDays)}</td>
                    <td>{formatDate(product.delay.expectedCompletionDate)}</td>
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
