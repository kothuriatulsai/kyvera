import type { TechPackListItem } from '@kyvera/shared-types'
import { apiGet, apiPostMultipart } from './client'

const enc = encodeURIComponent

export const fetchTechPacks = (projectId: string) =>
  apiGet<TechPackListItem[]>(`/tech-packs?projectId=${enc(projectId)}`)

export interface CreateTechPackInput {
  projectId: string
  notes?: string
  files: File[]
}

/** The response is actually a full TechPackDetail (versions included), but
 * callers here only ever need `id`/`code` - see shared-types for why the
 * fuller shape isn't typed yet. */
export const createTechPack = ({ projectId, notes, files }: CreateTechPackInput) => {
  const form = new FormData()
  form.append('projectId', projectId)
  if (notes) form.append('notes', notes)
  for (const file of files) form.append('files', file)
  return apiPostMultipart<TechPackListItem>('/tech-packs', form)
}
