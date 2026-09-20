import { Link, useParams } from 'react-router'
import { fetchProduct, fetchProductDelay, fetchStages } from '../api/products'
import { AssigneeProductDetail } from '../components/AssigneeProductDetail'
import { AsyncView } from '../components/AsyncView'
import { FullProductDetail } from '../components/FullProductDetail'
import { useAsync } from '../hooks/useAsync'

export function ProductDetailPage() {
  const { id = '' } = useParams()

  const state = useAsync(async () => {
    const product = await fetchProduct(id)

    // Someone assigned to part of the product gets only their own stages, and
    // that is all this page asks for: the delay breakdown and the stage list would
    // be the whole workflow, which the API deliberately holds back from them.
    if (product.view === 'assignee') {
      return { kind: 'assignee' as const, product }
    }

    const [delay, stages] = await Promise.all([fetchProductDelay(id), fetchStages()])
    if (delay.view !== 'full') {
      throw new Error('Unexpected response for this product')
    }
    return { kind: 'full' as const, product, delay, stages }
  }, id)

  return (
    <section>
      <p>
        <Link to="/">← All products</Link>
      </p>
      <AsyncView state={state}>
        {(data) =>
          data.kind === 'assignee' ? (
            // Keyed by product so navigating between two assigned products can't
            // carry one's local state (typed note, error) over to the other.
            <AssigneeProductDetail key={data.product.id} initial={data.product} />
          ) : (
            <FullProductDetail product={data.product} delay={data.delay} stages={data.stages} />
          )
        }
      </AsyncView>
    </section>
  )
}
