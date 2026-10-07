import type { ReactNode } from 'react'
import type { UserRole } from '@kyvera/shared-types'
import { NotFoundPage } from '../components/NotFoundPage'
import { useAuth } from './useAuth'

interface RequireRoleProps {
  role: UserRole
  children: ReactNode
}

/**
 * Wraps a role-restricted route (e.g. /users). Anyone else sees the same
 * "Page not found" the catch-all route renders (ADR 0011, point 3) - a
 * restriction is never named to someone it doesn't apply to. Mounted inside
 * `RequireAuth`, so `session` is never null here.
 */
export function RequireRole({ role, children }: RequireRoleProps) {
  const { session } = useAuth()
  if (session?.user.role !== role) {
    return <NotFoundPage />
  }
  return <>{children}</>
}
