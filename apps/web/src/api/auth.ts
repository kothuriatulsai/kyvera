import type { LoginRequest, LoginResponse } from '@kyvera/shared-types'
import { apiRequest } from './client'

export const login = (credentials: LoginRequest) =>
  apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: credentials,
    authenticated: false,
  })
