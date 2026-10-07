import type { ApprovalDecision, Project, TechPackListItem, TechPackVersion, UserRole } from '@kyvera/shared-types'
import { describe, expect, it } from 'vitest'
import { canConfirm, canCreateProject, canCreateTechPack, canDecide, canRemark, canUploadVersion } from './sopPermissions'

const ALL_ROLES: UserRole[] = [
  'ADMIN',
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

const USER = {
  id: 'u1',
  name: 'Someone',
  email: 'someone@kyvera.dev',
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-09-01T00:00:00.000Z',
}

function version(decision?: ApprovalDecision, confirmed = false): TechPackVersion {
  return {
    id: 'v1',
    techPackId: 'tp1',
    versionNumber: 1,
    notes: null,
    uploadedById: USER.id,
    uploadedBy: { ...USER, role: 'PRODUCT_DESIGNER' },
    uploadedAt: USER.createdAt,
    attachments: [],
    remarks: [],
    confirmation: confirmed
      ? { id: 'c1', techPackVersionId: 'v1', confirmedById: USER.id, confirmedBy: { ...USER, role: 'ENGINEERING' }, confirmedAt: USER.createdAt }
      : null,
    approval: decision
      ? { id: 'ap1', techPackVersionId: 'v1', decision, decidedById: USER.id, decidedBy: { ...USER, role: 'MANAGEMENT' }, decidedAt: USER.createdAt, notes: null }
      : null,
  }
}

function techPackState(voidedAt: string | null, versions: TechPackVersion[]) {
  return { voidedAt, versions }
}

describe('canUploadVersion', () => {
  it.each(['PRODUCT_DESIGNER', 'ADMIN'] as UserRole[])('allows %s on a fresh TechPack with zero versions', (role) => {
    expect(canUploadVersion(role, techPackState(null, []))).toBe(true)
  })

  it.each(ALL_ROLES.filter((role) => role !== 'PRODUCT_DESIGNER' && role !== 'ADMIN'))('forbids %s', (role) => {
    expect(canUploadVersion(role, techPackState(null, []))).toBe(false)
  })

  it('forbids it once the TechPack is voided', () => {
    expect(canUploadVersion('PRODUCT_DESIGNER', techPackState('2026-10-01T00:00:00.000Z', [version()]))).toBe(false)
  })

  it('forbids it once any version is approved', () => {
    expect(canUploadVersion('PRODUCT_DESIGNER', techPackState(null, [version('APPROVED')]))).toBe(false)
  })

  it('allows it when a version was rejected (no new version could exist yet) but not approved', () => {
    // This is a hypothetical-state check only: a REJECTED decision always
    // voids the TechPack in the same transaction server-side, so this exact
    // combination (rejected, not voided) can't really occur - but the
    // function itself should judge purely on what it's given.
    expect(canUploadVersion('PRODUCT_DESIGNER', techPackState(null, [version('REJECTED')]))).toBe(true)
  })
})

describe('canRemark', () => {
  it.each(['ENGINEERING', 'PRODUCT_DESIGNER', 'ADMIN'] as UserRole[])('allows %s', (role) => {
    expect(canRemark(role, { voidedAt: null })).toBe(true)
  })

  it.each(ALL_ROLES.filter((role) => !['ENGINEERING', 'PRODUCT_DESIGNER', 'ADMIN'].includes(role)))(
    'forbids %s',
    (role) => {
      expect(canRemark(role, { voidedAt: null })).toBe(false)
    },
  )

  it('forbids it once the TechPack is voided, even for an otherwise-allowed role', () => {
    expect(canRemark('ENGINEERING', { voidedAt: '2026-10-01T00:00:00.000Z' })).toBe(false)
  })
})

describe('canConfirm', () => {
  it('allows ENGINEERING when the latest version is unconfirmed', () => {
    expect(canConfirm('ENGINEERING', techPackState(null, [version()]), version())).toBe(true)
  })

  it.each(ALL_ROLES.filter((role) => role !== 'ENGINEERING'))('forbids %s', (role) => {
    expect(canConfirm(role, techPackState(null, [version()]), version())).toBe(false)
  })

  it('forbids it once the latest version is already confirmed', () => {
    const confirmed = version(undefined, true)
    expect(canConfirm('ENGINEERING', techPackState(null, [confirmed]), confirmed)).toBe(false)
  })

  it('forbids it once the TechPack is voided', () => {
    expect(canConfirm('ENGINEERING', techPackState('2026-10-01T00:00:00.000Z', [version()]), version())).toBe(false)
  })

  it('forbids it once the TechPack is already approved', () => {
    const approved = version('APPROVED')
    expect(canConfirm('ENGINEERING', techPackState(null, [approved]), approved)).toBe(false)
  })
})

describe('canDecide', () => {
  it('allows MANAGEMENT once the latest version is confirmed', () => {
    const confirmed = version(undefined, true)
    expect(canDecide('MANAGEMENT', techPackState(null, [confirmed]), confirmed)).toBe(true)
  })

  it.each(ALL_ROLES.filter((role) => role !== 'MANAGEMENT'))('forbids %s', (role) => {
    const confirmed = version(undefined, true)
    expect(canDecide(role, techPackState(null, [confirmed]), confirmed)).toBe(false)
  })

  it('forbids it while the latest version is still unconfirmed', () => {
    expect(canDecide('MANAGEMENT', techPackState(null, [version()]), version())).toBe(false)
  })

  it('forbids it once the TechPack is voided', () => {
    const confirmed = version(undefined, true)
    expect(canDecide('MANAGEMENT', techPackState('2026-10-01T00:00:00.000Z', [confirmed]), confirmed)).toBe(false)
  })

  it('forbids it once the TechPack is already approved', () => {
    const approvedAndConfirmed = version('APPROVED', true)
    expect(canDecide('MANAGEMENT', techPackState(null, [approvedAndConfirmed]), approvedAndConfirmed)).toBe(false)
  })
})
