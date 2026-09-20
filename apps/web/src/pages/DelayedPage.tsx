import { Link } from 'react-router'
import { fetchProducts } from '../api/products'
import { AssigneeProductsTable } from '../components/AssigneeProductsTable'
import { AsyncView } from '../components/AsyncView'
import { useAsync } from '../hooks/useAsync'
import { formatDate, formatDays } from '../lib/format'
import { assigneeViewsOnly, fullViewsOnly } from '../lib/views'

export function DelayedPage() {
  const state = useAsync(fetchProducts)

  return (
    <section>
      <h1>Delayed products</h1>
      <AsyncView state={state}>
        {(entries) => {
          const delayed = fullViewsOnly(entries)
            .filter((product) => product.status === 'DELAYED')
            .sort((a, b) => b.delay.totalDelayDays - a.delay.totalDelayDays)

          // For someone assigned to part of a product, "delayed" can only mean their
          // own stage: keep just the stages that are running late.
          const lateAssigned = assigneeViewsOnly(entries)
            .map((product) => ({
              ...product,
              stages: product.stages.filter((stage) => stage.delay?.delayed),
            }))
            .filter((product) => product.stages.length > 0)

          if (delayed.length === 0 && lateAssigned.length === 0) {
            return <p className="muted">Nothing is delayed right now.</p>
          }

          return (
            <>
              {delayed.length > 0 && (
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
              )}

              {lateAssigned.length > 0 && (
                <>
                  <h2>Your stages running late</h2>
                  <AssigneeProductsTable products={lateAssigned} />
                </>
              )}
            </>
          )
        }}
      </AsyncView>
    </section>
  )
}
