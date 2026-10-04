import type { Project, TechPackListItem, UserRole } from '@kyvera/shared-types'
import { describe, expect, it } from 'vitest'
import { canCreateProject, canCreateTechPack } from './sopPermissions'

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

describe('canCreateTechPack', () => {
  const protoProject: Pick<Project, 'phase'> = { phase: 'PROTO' }
  const bulkProject: Pick<Project, 'phase'> = { phase: 'BULK' }

  function techPack(overrides: Partial<Pick<TechPackListItem, 'phase' | 'voidedAt'>> = {}) {
    return { phase: 'PROTO' as const, voidedAt: null, ...overrides }
  }

  it.each(['PRODUCT_DESIGNER', 'ADMIN'] as UserRole[])(
    'allows %s when the Project has no TechPack yet',
    (role) => {
      expect(canCreateTechPack(role, protoProject, [])).toBe(true)
    },
  )

  it.each(ALL_ROLES.filter((role) => role !== 'PRODUCT_DESIGNER' && role !== 'ADMIN'))(
    'forbids %s regardless of TechPack state',
    (role) => {
      expect(canCreateTechPack(role, protoProject, [])).toBe(false)
    },
  )

  it('forbids a role that may otherwise create one when a non-voided TechPack already exists for the current phase', () => {
    const techPacks = [techPack({ phase: 'PROTO', voidedAt: null })]
    expect(canCreateTechPack('PRODUCT_DESIGNER', protoProject, techPacks)).toBe(false)
    expect(canCreateTechPack('ADMIN', protoProject, techPacks)).toBe(false)
  })

  it('allows it once that TechPack is voided', () => {
    const techPacks = [techPack({ phase: 'PROTO', voidedAt: '2026-10-01T00:00:00.000Z' })]
    expect(canCreateTechPack('PRODUCT_DESIGNER', protoProject, techPacks)).toBe(true)
  })

  it('allows it when the only non-voided TechPack is for a different phase', () => {
    const techPacks = [techPack({ phase: 'BULK', voidedAt: null })]
    expect(canCreateTechPack('PRODUCT_DESIGNER', protoProject, techPacks)).toBe(true)
    // ...and the symmetric case, since the rule checks the Project's *current* phase.
    expect(canCreateTechPack('PRODUCT_DESIGNER', bulkProject, [techPack({ phase: 'PROTO', voidedAt: null })])).toBe(
      true,
    )
  })
})
