import type {
  ProductDelayView,
  ProductDetailView,
  ProductListEntry,
  StageDefinition,
} from '@kyvera/shared-types'
import { apiGet } from './client'

// What comes back depends on who is asking (ADR 0004): each product is either a
// full view or an assignee view. Callers narrow on `view`.
export const fetchProducts = () => apiGet<ProductListEntry[]>('/products')

export const fetchProduct = (id: string) =>
  apiGet<ProductDetailView>(`/products/${encodeURIComponent(id)}`)

export const fetchProductDelay = (id: string) =>
  apiGet<ProductDelayView>(`/products/${encodeURIComponent(id)}/delay`)

export const fetchStages = () => apiGet<StageDefinition[]>('/stages')
