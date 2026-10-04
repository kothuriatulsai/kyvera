import type { UserRole } from '@kyvera/shared-types'
import { describe, expect, it } from 'vitest'
import { canCreateProject } from './sopPermissions'

const ALL_ROLES: UserRole[] = [
  'ADMIN',
  'MANAGER',
  'ENGINEER',
  'FINANCE',
  'PMO',
  'PRODUCT_DESIGNER',
  'ENGINEERING',
  'MANAGEMENT',
  'MERCHANDISER',
]

describe('canCreateProject', () => {
  it.each(['PMO', 'ADMIN'] as UserRole[])('allows %s', (role) => {
    expect(canCreateProject(role)).toBe(true)
  })

  // Table-driven over every other role, including the old module's, so a role
  // added later can't silently gain this by accident.
  it.each(ALL_ROLES.filter((role) => role !== 'PMO' && role !== 'ADMIN'))('forbids %s', (role) => {
    expect(canCreateProject(role)).toBe(false)
  })
})
