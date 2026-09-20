import { Link } from 'react-router'
import { fetchProducts } from '../api/products'
import { AssigneeProductsTable } from '../components/AssigneeProductsTable'
import { AsyncView } from '../components/AsyncView'
import { StatusBadge } from '../components/StatusBadge'
import { useAsync } from '../hooks/useAsync'
import { formatDate } from '../lib/format'
import { assigneeViewsOnly, fullViewsOnly } from '../lib/views'

export function ProductListPage() {
  const state = useAsync(fetchProducts)

  return (
    <section>
      <h1>Products</h1>
      <AsyncView state={state}>
        {(entries) => {
          const rows = fullViewsOnly(entries)
          const assigned = assigneeViewsOnly(entries)

          if (rows.length === 0 && assigned.length === 0) {
            return <p className="muted">No products yet.</p>
          }

          return (
            <>
              {rows.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Stage</th>
                      <th>Owner</th>
                      <th>Status</th>
                      <th>Projected completion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((product) => (
                      <tr key={product.id}>
                        <td>
                          <Link to={`/products/${product.id}`}>{product.name}</Link>
                          <span className="muted"> v{product.currentVersion}</span>
                        </td>
                        <td>{product.currentStage?.name ?? '—'}</td>
                        <td>{product.owner.name}</td>
                        <td>
                          <StatusBadge status={product.status} />
                        </td>
                        <td>{formatDate(product.delay.expectedCompletionDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {assigned.length > 0 && (
                <>
                  <h2>Assigned to you</h2>
                  <AssigneeProductsTable products={assigned} />
                </>
              )}
            </>
          )
        }}
      </AsyncView>
    </section>
  )
}
