import type { AssigneeProductDetail as AssigneeProductDetailData } from '@kyvera/shared-types'
import { useState } from 'react'
import { fetchProduct } from '../api/products'
import { AssigneeStageCard } from './AssigneeStageCard'

interface AssigneeProductDetailProps {
  initial: AssigneeProductDetailData
}

/**
 * A product as someone assigned to part of it sees it: the product's name, then
 * only their own stage(s). No status, owner, dates, other stages or history -
 * the API doesn't send them, so there is nothing here to render or to hide.
 */
export function AssigneeProductDetail({ initial }: AssigneeProductDetailProps) {
  const [detail, setDetail] = useState(initial)

  async function reload() {
    const fresh = await fetchProduct(detail.id)
    // Still an assignee view: the viewer's relationship to it doesn't change by
    // marking ready or adding a note. (If it ever did, the next navigation shows it.)
    if (fresh.view === 'assignee') setDetail(fresh)
  }

  return (
    <>
      <header className="detail-header">
        <h1>{detail.name}</h1>
      </header>
      {detail.description && <p>{detail.description}</p>}
      <p className="muted">
        You are assigned to {detail.stages.length === 1 ? 'one stage' : `${detail.stages.length} stages`}{' '}
        of this product.
      </p>

      {detail.stages.map((stage) => (
        <AssigneeStageCard
          key={stage.assignmentId}
          productId={detail.id}
          stage={stage}
          onChanged={reload}
        />
      ))}
    </>
  )
}
