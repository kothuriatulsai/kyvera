import { Link } from 'react-router'
import { AsyncView } from '../components/AsyncView'
import { StatusBadge } from '../components/StatusBadge'
import { fetchProducts } from '../api/products'
import { useAsync } from '../hooks/useAsync'
import { formatDate } from '../lib/format'

export function ProductListPage() {
  const state = useAsync(fetchProducts)

  return (
    <section>
      <h1>Products</h1>
      <AsyncView state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="muted">No products yet.</p>
          ) : (
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
          )
        }
      </AsyncView>
    </section>
  )
}
