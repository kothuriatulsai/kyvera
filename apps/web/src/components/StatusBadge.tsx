import type { ProductStatus } from '@kyvera/shared-types'
import { STATUS_LABELS } from '../lib/format'

export function StatusBadge({ status }: { status: ProductStatus }) {
  return <span className={`badge badge-${status.toLowerCase().replace('_', '-')}`}>{STATUS_LABELS[status]}</span>
}
