import type {
  AddTechPackRemarkRequest,
  DecideTechPackVersionRequest,
  DecideTechPackVersionResponse,
  TechPackConfirmation,
  TechPackDetail,
  TechPackListItem,
  TechPackRemark,
} from '@kyvera/shared-types'
import { apiGet, apiPost, apiPostMultipart } from './client'

const enc = encodeURIComponent

export const fetchTechPacks = (projectId: string) =>
  apiGet<TechPackListItem[]>(`/tech-packs?projectId=${enc(projectId)}`)

export const fetchTechPack = (id: string) => apiGet<TechPackDetail>(`/tech-packs/${enc(id)}`)

function attachmentForm(notes: string | undefined, files: File[]): FormData {
  const form = new FormData()
  if (notes) form.append('notes', notes)
  for (const file of files) form.append('files', file)
  return form
}

export interface CreateTechPackInput {
  projectId: string
  notes?: string
  files: File[]
}

export const createTechPack = ({ projectId, notes, files }: CreateTechPackInput) => {
  const form = attachmentForm(notes, files)
  form.append('projectId', projectId)
  return apiPostMultipart<TechPackDetail>('/tech-packs', form)
}

export interface UploadTechPackVersionInput {
  notes?: string
  files: File[]
}

export const uploadTechPackVersion = (techPackId: string, { notes, files }: UploadTechPackVersionInput) =>
  apiPostMultipart<TechPackDetail>(`/tech-packs/${enc(techPackId)}/versions`, attachmentForm(notes, files))

export const addTechPackRemark = (techPackId: string, versionNumber: number, body: string) =>
  apiPost<TechPackRemark>(`/tech-packs/${enc(techPackId)}/versions/${versionNumber}/remarks`, {
    body,
  } satisfies AddTechPackRemarkRequest)

export const confirmTechPackVersion = (techPackId: string, versionNumber: number) =>
  apiPost<TechPackConfirmation>(`/tech-packs/${enc(techPackId)}/versions/${versionNumber}/confirm`)

export const decideTechPackVersion = (
  techPackId: string,
  versionNumber: number,
  body: DecideTechPackVersionRequest,
) =>
  apiPost<DecideTechPackVersionResponse>(
    `/tech-packs/${enc(techPackId)}/versions/${versionNumber}/decision`,
    body,
  )
