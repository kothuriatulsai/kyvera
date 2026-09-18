import type { ProductDelay, ProductStatus, ProductSummary } from '@kyvera/shared-types'
import { fetchProductDelay, fetchProducts } from '../api/products'
import { effectiveStatus } from '../lib/format'
import { useAsync, type AsyncState } from './useAsync'

export interface ProductWithDelay {
  product: ProductSummary
  /** Undefined if this product's delay lookup failed. */
  delay: ProductDelay | undefined
  status: ProductStatus
}

/**
 * Products joined with their live delay breakdown. `products.status` is only
 * persisted when a product is created or transitioned, so a product that has
 * sat in a stage past its expected duration since then still reads ON_TRACK in
 * the database — `GET /products/:id/delay` is the only always-current source.
 * A failed delay lookup degrades that one row to its persisted status instead
 * of failing the whole list.
 */
export function useProductsWithDelays(): AsyncState<ProductWithDelay[]> {
  return useAsync(async () => {
    const products = await fetchProducts()

    return Promise.all(
      products.map(async (product): Promise<ProductWithDelay> => {
        const delay = await fetchProductDelay(product.id).catch(() => undefined)
        return { product, delay, status: effectiveStatus(product.status, delay?.delayed) }
      }),
    )
  })
}
