import type {
  ChangeUserRoleRequest,
  CreateUserRequest,
  ProjectMembership,
  TemporaryPasswordResponse,
  UserSummary,
} from '@kyvera/shared-types'
import { apiGet, apiPatch, apiPost } from './client'

const enc = encodeURIComponent

export const fetchUsers = () => apiGet<UserSummary[]>('/users')

export const createUser = (body: CreateUserRequest) => apiPost<TemporaryPasswordResponse>('/users', body)

export const changeUserRole = (id: string, body: ChangeUserRoleRequest) =>
  apiPatch<UserSummary>(`/users/${enc(id)}/role`, body)

export const deactivateUser = (id: string) => apiPost<UserSummary>(`/users/${enc(id)}/deactivate`)

export const reactivateUser = (id: string) => apiPost<UserSummary>(`/users/${enc(id)}/reactivate`)

export const resetPassword = (id: string) => apiPost<TemporaryPasswordResponse>(`/users/${enc(id)}/reset-password`)

export const fetchProjectsForUser = (id: string) => apiGet<ProjectMembership[]>(`/users/${enc(id)}/projects`)
