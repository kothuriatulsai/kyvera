import type { ChangePasswordRequest, LoginRequest, LoginResponse, UserSummary } from '@kyvera/shared-types'
import { apiGet, apiPost, apiRequest } from './client'

export const login = (credentials: LoginRequest) =>
  apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: credentials,
    authenticated: false,
  })

export const fetchMe = () => apiGet<UserSummary>('/auth/me')

export const changePassword = (body: ChangePasswordRequest) =>
  apiPost<UserSummary>('/auth/change-password', body)
