import type {
  AddProgressNoteRequest,
  AddProgressNoteResponse,
  MarkReadyResponse,
  ProductDelayView,
  ProductDetailView,
  ProductListEntry,
  StageDefinition,
} from '@kyvera/shared-types'
import { apiGet, apiPost } from './client'

const enc = encodeURIComponent

// What comes back depends on who is asking (ADR 0004): each product is either a
// full view or an assignee view. Callers narrow on `view`.
export const fetchProducts = () => apiGet<ProductListEntry[]>('/products')

export const fetchProduct = (id: string) => apiGet<ProductDetailView>(`/products/${enc(id)}`)

export const fetchProductDelay = (id: string) =>
  apiGet<ProductDelayView>(`/products/${enc(id)}/delay`)

export const fetchStages = () => apiGet<StageDefinition[]>('/stages')

/** An assignee's own "done with this stage" mark. Never moves the product. */
export const markAssignmentReady = (productId: string, assignmentId: string) =>
  apiPost<MarkReadyResponse>(`/products/${enc(productId)}/assignments/${enc(assignmentId)}/ready`)

/** A progress note on a stage you are assigned to. Never moves the product. */
export const addProgressNote = (productId: string, stageId: string, note: string) =>
  apiPost<AddProgressNoteResponse>(
    `/products/${enc(productId)}/stages/${enc(stageId)}/notes`,
    { note } satisfies AddProgressNoteRequest,
  )

/**
 * Move the product one stage forward. The server decides whether the caller may
 * (a stage's sole assignee can; otherwise an admin, owner or assigned manager),
 * and answers 403 with the reason when they can't.
 */
export const advanceStage = (productId: string) =>
  apiPost<ProductDetailView>(`/products/${enc(productId)}/transition`, {})
