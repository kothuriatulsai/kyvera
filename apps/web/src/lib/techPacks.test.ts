import type { TechPackListItem } from '@kyvera/shared-types'
import { describe, expect, it } from 'vitest'
import { successorOf, sortTechPacks } from './techPacks'

const PROJECT = { id: 'p1', code: 'PRJ-000001', name: 'Widget Project' }
const USER = {
  id: 'u1',
  name: 'Deepa Designer',
  email: 'designer@kyvera.dev',
  role: 'PRODUCT_DESIGNER' as const,
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-09-01T00:00:00.000Z',
}

function techPack(overrides: Partial<TechPackListItem> = {}): TechPackListItem {
  return {
    id: 'tp1',
    code: 'TP-000001',
    projectId: PROJECT.id,
    project: PROJECT,
    phase: 'PROTO',
    createdById: USER.id,
    createdBy: USER,
    createdAt: '2026-09-01T00:00:00.000Z',
    voidedAt: null,
    voidedById: null,
    voidReason: null,
    supersedesId: null,
    ...overrides,
  }
}

describe('sortTechPacks', () => {
  it('puts the non-voided TechPack first, regardless of its position in the input', () => {
    const voided = techPack({ id: 'tp1', voidedAt: '2026-09-02T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z' })
    const active = techPack({ id: 'tp2', voidedAt: null, createdAt: '2026-09-03T00:00:00.000Z' })

    expect(sortTechPacks([voided, active]).map((tp) => tp.id)).toEqual(['tp2', 'tp1'])
    expect(sortTechPacks([active, voided]).map((tp) => tp.id)).toEqual(['tp2', 'tp1'])
  })

  it('sorts voided TechPacks newest first among themselves', () => {
    const older = techPack({ id: 'tp1', voidedAt: '2026-09-02T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z' })
    const newer = techPack({ id: 'tp2', voidedAt: '2026-09-05T00:00:00.000Z', createdAt: '2026-09-04T00:00:00.000Z' })

    expect(sortTechPacks([older, newer]).map((tp) => tp.id)).toEqual(['tp2', 'tp1'])
  })

  it('does not mutate the input array', () => {
    const input = [techPack({ id: 'tp1' }), techPack({ id: 'tp2', createdAt: '2026-09-02T00:00:00.000Z' })]
    const copy = [...input]

    sortTechPacks(input)

    expect(input).toEqual(copy)
  })
})

describe('successorOf', () => {
  it('finds the TechPack whose supersedesId points at the given one', () => {
    const voided = techPack({ id: 'tp1' })
    const successor = techPack({ id: 'tp2', supersedesId: 'tp1' })

    expect(successorOf(voided, [voided, successor])?.id).toBe('tp2')
  })

  it('returns undefined when nothing supersedes it', () => {
    const active = techPack({ id: 'tp1' })

    expect(successorOf(active, [active])).toBeUndefined()
  })
})
