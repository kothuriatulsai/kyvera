import type { TechPackDetail, TechPackVersion, UserRole } from '@kyvera/shared-types'
import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALL_SESSIONS,
  adminSession,
  engineeringSession,
  engineeringUser,
  managementSession,
  managementUser,
  productDesignerSession,
  productDesignerUser,
} from '../test/fixtures'
import { route, stubApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

const TECH_PACK = '/tech-packs/tp1'
const PROJECT = { id: 'p1', code: 'PRJ-000001', name: 'Solar Lantern Proto', phase: 'PROTO' as const }

function version(overrides: Partial<TechPackVersion> = {}): TechPackVersion {
  return {
    id: 'v1',
    techPackId: 'tp1',
    versionNumber: 1,
    notes: null,
    uploadedById: productDesignerUser.id,
    uploadedBy: productDesignerUser,
    uploadedAt: '2026-09-02T00:00:00.000Z',
    attachments: [],
    remarks: [],
    confirmation: null,
    approval: null,
    ...overrides,
  }
}

function techPack(overrides: Partial<TechPackDetail> = {}): TechPackDetail {
  return {
    id: 'tp1',
    code: 'TP-000001',
    projectId: PROJECT.id,
    project: PROJECT,
    phase: 'PROTO',
    createdById: productDesignerUser.id,
    createdBy: productDesignerUser,
    createdAt: '2026-09-02T00:00:00.000Z',
    voidedAt: null,
    voidedById: null,
    voidedBy: null,
    voidReason: null,
    supersedesId: null,
    supersedes: null,
    supersededBy: null,
    versions: [version()],
    ...overrides,
  }
}

function stubTechPack(tp: TechPackDetail, extra: Parameters<typeof stubApi>[0] = []) {
  return stubApi([...extra, route('GET', TECH_PACK, { body: tp })])
}

beforeEach(() => {
  // jsdom doesn't implement createObjectURL - stub it so the download flow
  // can run to completion without touching the real API.
  URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  URL.revokeObjectURL = vi.fn()
  // jsdom's real anchor click schedules a "navigate to this href" it then
  // can't implement (logging a harmless but noisy error); the download flow
  // only needs the click to happen, not an actual navigation.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

describe('header and version timeline', () => {
  it('shows the code and a link back to the project', async () => {
    stubTechPack(techPack())
    renderApp(TECH_PACK, { session: adminSession })

    await screen.findByRole('heading', { name: 'TP-000001' })
    const back = screen.getByRole('link', { name: /Solar Lantern Proto/ })
    expect(back.getAttribute('href')).toBe('/projects/p1')
  })

  it('says so when there are no versions yet', async () => {
    stubTechPack(techPack({ versions: [] }))
    renderApp(TECH_PACK, { session: adminSession })

    await screen.findByText('No versions yet.')
  })

  it('surfaces the API error message when the tech pack is not found', async () => {
    stubApi([route('GET', TECH_PACK, { status: 404, body: { error: 'Tech Pack not found' } })])
    renderApp(TECH_PACK, { session: adminSession })

    expect((await screen.findByRole('alert')).textContent).toBe('Tech Pack not found')
  })

  it('marks only the newest version Latest, newest first', async () => {
    const v1 = version({ id: 'v1', versionNumber: 1 })
    const v2 = version({ id: 'v2', versionNumber: 2 })
    stubTechPack(techPack({ versions: [v2, v1] }))
    renderApp(TECH_PACK, { session: adminSession })

    const items = await screen.findAllByRole('listitem')
    const versionItems = items.filter((li) => /^v\d/.test(li.textContent ?? ''))
    expect(versionItems[0].textContent).toContain('v2')
    expect(within(versionItems[0]).getByText('Latest')).toBeTruthy()
    expect(versionItems[1].textContent).toContain('v1')
    expect(within(versionItems[1]).queryByText('Latest')).toBeNull()
  })

  it('shows Confirmed by, Approved and Rejected badges from the version data', async () => {
    const confirmed = version({
      confirmation: {
        id: 'c1',
        techPackVersionId: 'v1',
        confirmedById: engineeringUser.id,
        confirmedBy: engineeringUser,
        confirmedAt: '2026-09-03T00:00:00.000Z',
      },
      approval: {
        id: 'ap1',
        techPackVersionId: 'v1',
        decision: 'APPROVED',
        decidedById: managementUser.id,
        decidedBy: managementUser,
        decidedAt: '2026-09-04T00:00:00.000Z',
        notes: null,
      },
    })
    stubTechPack(techPack({ versions: [confirmed] }))
    renderApp(TECH_PACK, { session: adminSession })

    await screen.findByText(`Confirmed by ${engineeringUser.name}`)
    expect(screen.getByText('Approved')).toBeTruthy()
    expect(screen.queryByText('Rejected')).toBeNull()
  })

  it('lists files as buttons, not links, and downloads with the bearer token', async () => {
    const withFile = version({
      attachments: [
        {
          id: 'a1',
          storageKey: 'sk1',
          originalName: 'spec.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          uploadedById: productDesignerUser.id,
          uploadedBy: productDesignerUser,
          uploadedAt: '2026-09-02T00:00:00.000Z',
          techPackVersionId: 'v1',
        },
      ],
    })
    const api = stubTechPack(techPack({ versions: [withFile] }), [
      route('GET', '/attachments/a1/download', { body: {} }),
    ])
    renderApp(TECH_PACK, { session: adminSession })

    const button = await screen.findByRole('button', { name: 'spec.pdf' })
    expect(screen.queryByRole('link', { name: 'spec.pdf' })).toBeNull()

    fireEvent.click(button)

    await vi.waitFor(() => {
      const call = api.calls.find((c) => c.path === '/attachments/a1/download')
      expect(call).toBeTruthy()
      expect(call?.authorization).toBe('Bearer tok-admin')
    })
  })
})

describe('remarks', () => {
  it('shows existing remarks and hides the post form from a role that may not post', async () => {
    const withRemark = version({
      remarks: [
        {
          id: 'r1',
          techPackVersionId: 'v1',
          authorId: engineeringUser.id,
          author: engineeringUser,
          body: 'Please check the BOM',
          createdAt: '2026-09-03T00:00:00.000Z',
        },
      ],
    })
    // MANAGEMENT may not post a remark (only ENGINEERING/PRODUCT_DESIGNER/ADMIN can).
    stubTechPack(techPack({ versions: [withRemark] }))
    renderApp(TECH_PACK, { session: managementSession })

    await screen.findByText('Please check the BOM')
    expect(screen.queryByLabelText('Add a remark')).toBeNull()
  })

  it.each(['ENGINEERING', 'PRODUCT_DESIGNER', 'ADMIN'] as UserRole[])('shows the post form to %s', async (role) => {
    const byRole = Object.fromEntries(ALL_SESSIONS.map((s) => [s.user.role, s])) as Record<
      UserRole,
      (typeof ALL_SESSIONS)[number]
    >
    stubTechPack(techPack())
    renderApp(TECH_PACK, { session: byRole[role] })

    await screen.findByText('No remarks yet.')
    expect(screen.getByLabelText('Add a remark')).toBeTruthy()
  })

  it('posts the trimmed body and reloads', async () => {
    const api = stubTechPack(techPack(), [
      route('POST', '/tech-packs/tp1/versions/1/remarks', {
        status: 201,
        body: { id: 'r1', techPackVersionId: 'v1', authorId: 'u', author: engineeringUser, body: 'ok', createdAt: '2026-09-03T00:00:00.000Z' },
      }),
    ])
    renderApp(TECH_PACK, { session: engineeringSession })
    await screen.findByText('No remarks yet.')

    fireEvent.change(screen.getByLabelText('Add a remark'), { target: { value: '  looks good  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post remark' }))

    await vi.waitFor(() => {
      const call = api.calls.find((c) => c.path === '/tech-packs/tp1/versions/1/remarks' && c.method === 'POST')
      expect(call?.body).toEqual({ body: 'looks good' })
    })
  })

  it('is hidden entirely once the TechPack is voided', async () => {
    stubTechPack(techPack({ voidedAt: '2026-09-10T00:00:00.000Z', voidReason: 'bad BOM' }))
    renderApp(TECH_PACK, { session: engineeringSession })

    await screen.findByText(/Voided/)
    expect(screen.queryByLabelText('Add a remark')).toBeNull()
  })
})

describe('Upload version control', () => {
  it.each(['PRODUCT_DESIGNER', 'ADMIN'] as UserRole[])('is shown to %s, offering v1 on a fresh TechPack', async (role) => {
    const session = role === 'PRODUCT_DESIGNER' ? productDesignerSession : adminSession
    stubTechPack(techPack({ versions: [] }))
    renderApp(TECH_PACK, { session })

    await screen.findByText('No versions yet.')
    expect(screen.getByRole('button', { name: 'Upload v1' })).toBeTruthy()
  })

  it('offers v2 once v1 already exists', async () => {
    stubTechPack(techPack({ versions: [version({ versionNumber: 1 })] }))
    renderApp(TECH_PACK, { session: productDesignerSession })

    await screen.findByRole('button', { name: 'Upload v2' })
  })

  it.each(ALL_SESSIONS.filter((s) => s.user.role !== 'PRODUCT_DESIGNER' && s.user.role !== 'ADMIN'))(
    'is not shown to $user.role',
    async (session) => {
      stubTechPack(techPack())
      renderApp(TECH_PACK, { session })

      await screen.findByRole('heading', { name: 'TP-000001' })
      expect(screen.queryByRole('heading', { name: 'Upload version' })).toBeNull()
    },
  )

  it('is hidden once a version is approved, even for an allowed role', async () => {
    stubTechPack(
      techPack({
        versions: [
          version({
            approval: {
              id: 'ap1',
              techPackVersionId: 'v1',
              decision: 'APPROVED',
              decidedById: managementUser.id,
              decidedBy: managementUser,
              decidedAt: '2026-09-04T00:00:00.000Z',
              notes: null,
            },
          }),
        ],
      }),
    )
    renderApp(TECH_PACK, { session: productDesignerSession })

    await screen.findByText('Approved')
    expect(screen.queryByRole('heading', { name: 'Upload version' })).toBeNull()
  })

  function fileOf(name: string, sizeBytes: number, type = 'application/pdf'): File {
    return new File([new Uint8Array(sizeBytes)], name, { type })
  }

  it('rejects a disallowed file before sending anything', async () => {
    const api = stubTechPack(techPack({ versions: [] }))
    renderApp(TECH_PACK, { session: productDesignerSession })
    await screen.findByText('No versions yet.')

    fireEvent.change(screen.getByLabelText('Files'), { target: { files: [fileOf('malware.exe', 10)] } })

    expect(screen.getByRole('alert').textContent).toMatch(/not allowed/)
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('uploads and reloads on success', async () => {
    const reloaded = techPack({ versions: [version({ versionNumber: 1 }), version({ id: 'v2', versionNumber: 2 })] })
    const api = stubApi([
      route('GET', TECH_PACK, { body: techPack({ versions: [version({ versionNumber: 1 })] }) }),
      route('POST', '/tech-packs/tp1/versions', { status: 201, body: reloaded }),
    ])
    renderApp(TECH_PACK, { session: productDesignerSession })
    await screen.findByRole('button', { name: 'Upload v2' })

    fireEvent.change(screen.getByLabelText('Files'), { target: { files: [fileOf('spec.pdf', 1024)] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload v2' }))

    await vi.waitFor(() => {
      expect(api.calls.some((c) => c.path === '/tech-packs/tp1/versions' && c.method === 'POST')).toBe(true)
    })
  })

  it('surfaces a server error without losing the form', async () => {
    stubApi([
      route('GET', TECH_PACK, { body: techPack({ versions: [] }) }),
      route('POST', '/tech-packs/tp1/versions', { status: 409, body: { error: 'Tech Pack is voided' } }),
    ])
    renderApp(TECH_PACK, { session: productDesignerSession })
    await screen.findByText('No versions yet.')

    fireEvent.change(screen.getByLabelText('Files'), { target: { files: [fileOf('spec.pdf', 1024)] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload v1' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Tech Pack is voided')
    expect(screen.getByRole('heading', { name: 'Upload version' })).toBeTruthy()
  })
})

describe('Confirm control', () => {
  it('is shown to ENGINEERING while the latest version is unconfirmed', async () => {
    stubTechPack(techPack())
    renderApp(TECH_PACK, { session: engineeringSession })

    await screen.findByRole('button', { name: 'Confirm v1' })
  })

  it.each(ALL_SESSIONS.filter((s) => s.user.role !== 'ENGINEERING'))('is not shown to $user.role', async (session) => {
    stubTechPack(techPack())
    renderApp(TECH_PACK, { session })

    await screen.findByRole('heading', { name: 'TP-000001' })
    expect(screen.queryByRole('button', { name: /^Confirm/ })).toBeNull()
  })

  it('is hidden once the latest version is already confirmed', async () => {
    stubTechPack(
      techPack({
        versions: [
          version({
            confirmation: {
              id: 'c1',
              techPackVersionId: 'v1',
              confirmedById: engineeringUser.id,
              confirmedBy: engineeringUser,
              confirmedAt: '2026-09-03T00:00:00.000Z',
            },
          }),
        ],
      }),
    )
    renderApp(TECH_PACK, { session: engineeringSession })

    await screen.findByText(`Confirmed by ${engineeringUser.name}`)
    expect(screen.queryByRole('button', { name: /^Confirm/ })).toBeNull()
  })

  it('confirms and reloads on success', async () => {
    const api = stubApi([
      route('GET', TECH_PACK, { body: techPack() }),
      route('POST', '/tech-packs/tp1/versions/1/confirm', {
        status: 201,
        body: { id: 'c1', techPackVersionId: 'v1', confirmedById: 'u', confirmedBy: engineeringUser, confirmedAt: '2026-09-03T00:00:00.000Z' },
      }),
    ])
    renderApp(TECH_PACK, { session: engineeringSession })
    await screen.findByRole('button', { name: 'Confirm v1' })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm v1' }))

    await vi.waitFor(() => {
      expect(api.calls.some((c) => c.path === '/tech-packs/tp1/versions/1/confirm' && c.method === 'POST')).toBe(
        true,
      )
    })
  })

  it('surfaces a server error', async () => {
    stubApi([
      route('GET', TECH_PACK, { body: techPack() }),
      route('POST', '/tech-packs/tp1/versions/1/confirm', { status: 409, body: { error: 'Already confirmed' } }),
    ])
    renderApp(TECH_PACK, { session: engineeringSession })
    await screen.findByRole('button', { name: 'Confirm v1' })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm v1' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Already confirmed')
  })
})

describe('Decision control', () => {
  const confirmedVersion = version({
    confirmation: {
      id: 'c1',
      techPackVersionId: 'v1',
      confirmedById: engineeringUser.id,
      confirmedBy: engineeringUser,
      confirmedAt: '2026-09-03T00:00:00.000Z',
    },
  })

  it('is shown to MANAGEMENT once the latest version is confirmed', async () => {
    stubTechPack(techPack({ versions: [confirmedVersion] }))
    renderApp(TECH_PACK, { session: managementSession })

    await screen.findByRole('heading', { name: 'Decision' })
  })

  it('is not shown while the latest version is unconfirmed', async () => {
    stubTechPack(techPack())
    renderApp(TECH_PACK, { session: managementSession })

    await screen.findByRole('heading', { name: 'TP-000001' })
    expect(screen.queryByRole('heading', { name: 'Decision' })).toBeNull()
  })

  // Includes ADMIN and PRODUCT_DESIGNER: no role but MANAGEMENT may decide (ADR 0009).
  it.each(ALL_SESSIONS.filter((s) => s.user.role !== 'MANAGEMENT'))('is not shown to $user.role', async (session) => {
    stubTechPack(techPack({ versions: [confirmedVersion] }))
    renderApp(TECH_PACK, { session })

    await screen.findByRole('heading', { name: 'TP-000001' })
    expect(screen.queryByRole('heading', { name: 'Decision' })).toBeNull()
  })

  it('cannot reject without a reason', async () => {
    stubTechPack(techPack({ versions: [confirmedVersion] }))
    renderApp(TECH_PACK, { session: managementSession })
    await screen.findByRole('heading', { name: 'Decision' })

    fireEvent.click(screen.getByRole('radio', { name: 'Rejected' }))

    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '   ' } })
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'bad BOM' } })
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('can approve without a reason', async () => {
    stubTechPack(techPack({ versions: [confirmedVersion] }))
    renderApp(TECH_PACK, { session: managementSession })
    await screen.findByRole('heading', { name: 'Decision' })

    fireEvent.click(screen.getByRole('radio', { name: 'Approved' }))

    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('on approve, shows a persistent link to the new Proto Request even after reload reflects the approval', async () => {
    // Stateful, like techPacks.test.ts's `setup()`: the GET route must reflect
    // the approval on reload (the component's own `onChanged()` call), or this
    // test can't tell "the banner persists through a reload" apart from "the
    // mock never actually changed".
    const approvedTechPack = techPack({
      versions: [
        version({
          confirmation: confirmedVersion.confirmation,
          approval: {
            id: 'ap1',
            techPackVersionId: 'v1',
            decision: 'APPROVED',
            decidedById: managementUser.id,
            decidedBy: managementUser,
            decidedAt: '2026-09-05T00:00:00.000Z',
            notes: null,
          },
        }),
      ],
    })
    let current = techPack({ versions: [confirmedVersion] })
    stubApi([
      { method: 'GET', path: TECH_PACK, respond: () => ({ body: current }) },
      {
        method: 'POST',
        path: '/tech-packs/tp1/versions/1/decision',
        respond: () => {
          current = approvedTechPack
          return {
            status: 201,
            body: {
              decision: 'APPROVED',
              techPack: approvedTechPack,
              protoRequest: {
                id: 'pr1',
                code: 'PR-000001',
                projectId: 'p1',
                project: PROJECT,
                techPackVersionId: 'v1',
                techPackVersion: { id: 'v1', versionNumber: 1, techPack: { id: 'tp1', code: 'TP-000001' } },
                createdAt: '2026-09-05T00:00:00.000Z',
              },
            },
          }
        },
      },
    ])
    renderApp(TECH_PACK, { session: managementSession })
    await screen.findByRole('heading', { name: 'Decision' })

    fireEvent.click(screen.getByRole('radio', { name: 'Approved' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await screen.findByText(/View PR-000001 in Proto Requests/)
    // The decision form itself is gone now (the reload shows it's approved),
    // but the outcome link survives - it lives in the parent, not the form.
    expect(screen.queryByRole('heading', { name: 'Decision' })).toBeNull()
    expect(screen.getByText('Approved')).toBeTruthy()
  })

  it('on reject, shows a persistent banner linking to the successor, and the page-level voided banner too', async () => {
    const successor = { id: 'tp2', code: 'TP-000002' }
    const voidedTechPack = techPack({
      voidedAt: '2026-09-05T00:00:00.000Z',
      voidReason: 'bad BOM',
      supersededBy: successor,
      versions: [confirmedVersion],
    })
    // Stateful (see the approve test above): the page-level voided banner only
    // appears once the *reloaded* GET reflects voidedAt/supersededBy.
    let current = techPack({ versions: [confirmedVersion] })
    stubApi([
      { method: 'GET', path: TECH_PACK, respond: () => ({ body: current }) },
      {
        method: 'POST',
        path: '/tech-packs/tp1/versions/1/decision',
        respond: () => {
          current = voidedTechPack
          return { status: 201, body: { decision: 'REJECTED', techPack: { ...successor, versions: [] }, protoRequest: null } }
        },
      },
    ])
    renderApp(TECH_PACK, { session: managementSession })
    await screen.findByRole('heading', { name: 'Decision' })

    fireEvent.click(screen.getByRole('radio', { name: 'Rejected' }))
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'bad BOM' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    // The mocked reload resolves fast enough that there's no reliable window
    // to observe TechPackActions' own ephemeral banner separately from the
    // final, reloaded state - so this checks the settled result: the
    // page-level banner (driven by the reloaded TechPack's own voidedAt/
    // supersededBy, not ephemeral component state) is what's actually left
    // once the Actions panel (voided now) unmounts.
    await screen.findByText(/bad BOM/)
    expect(screen.queryByRole('heading', { name: 'Actions' })).toBeNull()
    const links = screen.getAllByRole('link', { name: 'TP-000002' })
    expect(links.some((l) => l.getAttribute('href') === '/tech-packs/tp2')).toBe(true)
  })

  it('surfaces a server error and reloads instead of silently failing', async () => {
    stubApi([
      route('GET', TECH_PACK, { body: techPack({ versions: [confirmedVersion] }) }),
      route('POST', '/tech-packs/tp1/versions/1/decision', { status: 409, body: { error: 'Already decided' } }),
    ])
    renderApp(TECH_PACK, { session: managementSession })
    await screen.findByRole('heading', { name: 'Decision' })

    fireEvent.click(screen.getByRole('radio', { name: 'Approved' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Already decided')
  })
})

describe('a voided TechPack is read-only', () => {
  it('shows the void reason and successor link, and no action controls or remark form at all', async () => {
    const successor = { id: 'tp2', code: 'TP-000002' }
    stubApi([
      route('GET', TECH_PACK, {
        body: techPack({
          voidedAt: '2026-09-10T00:00:00.000Z',
          voidReason: 'wrong BOM',
          voidedBy: managementUser,
          supersededBy: successor,
          versions: [version({ versionNumber: 1 })],
        }),
      }),
    ])
    renderApp(TECH_PACK, { session: adminSession })

    const notice = await screen.findByText(/wrong BOM/)
    expect(notice.textContent).toContain('Voided')
    const link = screen.getByRole('link', { name: 'TP-000002' })
    expect(link.getAttribute('href')).toBe('/tech-packs/tp2')

    expect(screen.queryByRole('heading', { name: 'Actions' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upload version' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Confirm/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Decision' })).toBeNull()
    expect(screen.queryByLabelText('Add a remark')).toBeNull()
  })

  it.each(['PRODUCT_DESIGNER', 'ENGINEERING', 'MANAGEMENT', 'ADMIN'] as UserRole[])(
    'is read-only for %s too',
    async (role) => {
      const byRole = Object.fromEntries(ALL_SESSIONS.map((s) => [s.user.role, s])) as Record<
        UserRole,
        (typeof ALL_SESSIONS)[number]
      >
      const session = byRole[role]
      stubTechPack(
        techPack({
          voidedAt: '2026-09-10T00:00:00.000Z',
          voidReason: 'wrong BOM',
          versions: [
            version({
              confirmation: {
                id: 'c1',
                techPackVersionId: 'v1',
                confirmedById: engineeringUser.id,
                confirmedBy: engineeringUser,
                confirmedAt: '2026-09-03T00:00:00.000Z',
              },
            }),
          ],
        }),
      )
      renderApp(TECH_PACK, { session })

      await screen.findByText(/wrong BOM/)
      expect(screen.queryByRole('heading', { name: 'Actions' })).toBeNull()
      expect(screen.queryByLabelText('Add a remark')).toBeNull()
    },
  )
})

describe('no SOP actions anywhere for roles with none', () => {
  const rich = techPack({
    versions: [
      version({
        confirmation: {
          id: 'c1',
          techPackVersionId: 'v1',
          confirmedById: engineeringUser.id,
          confirmedBy: engineeringUser,
          confirmedAt: '2026-09-03T00:00:00.000Z',
        },
      }),
    ],
  })

  it.each(['FINANCE', 'MERCHANDISER', 'MANAGER', 'ENGINEER', 'PMO'] as UserRole[])(
    '%s sees no action controls and no remark form, read or write',
    async (role) => {
      const byRole = Object.fromEntries(ALL_SESSIONS.map((s) => [s.user.role, s]))
      stubTechPack(rich)
      renderApp(TECH_PACK, { session: byRole[role] })

      await screen.findByRole('heading', { name: 'TP-000001' })
      expect(screen.queryByRole('heading', { name: 'Actions' })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Upload version' })).toBeNull()
      expect(screen.queryByRole('button', { name: /^Confirm/ })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Decision' })).toBeNull()
      expect(screen.queryByLabelText('Add a remark')).toBeNull()
    },
  )
})
