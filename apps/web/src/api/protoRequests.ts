import type { ProtoRequest } from '@kyvera/shared-types'
import { apiGet } from './client'

const enc = encodeURIComponent

export const fetchProtoRequests = (projectId?: string) =>
  apiGet<ProtoRequest[]>(projectId ? `/proto-requests?projectId=${enc(projectId)}` : '/proto-requests')

export const fetchProtoRequest = (id: string) => apiGet<ProtoRequest>(`/proto-requests/${enc(id)}`)
