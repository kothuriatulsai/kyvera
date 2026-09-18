import type {
  ProductDelay,
  ProductDetail,
  ProductSummary,
  StageDefinition,
} from '@kyvera/shared-types'
import { apiGet } from './client'

export const fetchProducts = () => apiGet<ProductSummary[]>('/products')

export const fetchProduct = (id: string) =>
  apiGet<ProductDetail>(`/products/${encodeURIComponent(id)}`)

export const fetchProductDelay = (id: string) =>
  apiGet<ProductDelay>(`/products/${encodeURIComponent(id)}/delay`)

export const fetchStages = () => apiGet<StageDefinition[]>('/stages')
