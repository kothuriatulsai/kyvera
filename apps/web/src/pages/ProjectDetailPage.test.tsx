import type { Project, ProtoRequest, TechPackDetail, TechPackListItem } from '@kyvera/shared-types'
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ALL_SESSIONS,
  adminSession,
  pmoSession,
  productDesignerSession,
  productDesignerUser,
} from '../test/fixtures'
import { route, stubApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

const PROJECT = '/projects/p1'

const protoProject: Project = {
  id: 'p1',
  code: 'PRJ-000001',
  name: 'Solar Lantern Proto',
  productName: 'Solar Lantern',
  productCategory: 'Lighting',
  phase: 'PROTO',
  status: 'ACTIVE',
  protoCompletedAt: null,
  completedAt: null,
  createdById: 'u-pmo',
  createdBy: {
    id: 'u-pmo',
    name: 'Priya PMO',
    email: 'pmo@kyvera.dev',
    role: 'PMO',
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  createdAt: '2026-09-01T00:00:00.000Z',
}

function techPack(overrides: Partial<TechPackListItem> = {}): TechPackListItem {
  return {
    id: 'tp1',
    code: 'TP-000001',
    projectId: 'p1',
    project: { id: 'p1', code: 'PRJ-000001', name: 'Solar Lantern Proto' },
    phase: 'PROTO',
    createdById: productDesignerUser.id,
    createdBy: productDesignerUser,
    createdAt: '2026-09-02T00:00:00.000Z',
    voidedAt: null,
    voidedById: null,
    voidReason: null,
    supersedesId: null,
    ...overrides,
  }
}

/** Minimal shape for the destination of "create, then navigate to it" - the
 * real detail screen's own content is covered by TechPackDetailPage.test.tsx. */
function techPackDetail(overrides: Partial<TechPackDetail> = {}): TechPackDetail {
  return {
    id: 'tp1',
    code: 'TP-000001',
    projectId: 'p1',
    project: { id: 'p1', code: 'PRJ-000001', name: 'Solar Lantern Proto', phase: 'PROTO' },
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
    versions: [],
    ...overrides,
  }
}

function protoRequest(overrides: Partial<ProtoRequest> = {}): ProtoRequest {
  return {
    id: 'proto1',
    code: 'PR-000001',
    projectId: 'p1',
    project: { id: 'p1', code: 'PRJ-000001', name: 'Solar Lantern Proto' },
    techPackVersionId: 'v1',
    techPackVersion: {
      id: 'v1',
      versionNumber: 1,
      techPack: { id: 'tp1', code: 'TP-000001' },
      attachments: [],
      approval: null,
    },
    createdAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

function stubDetail(opts: {
  techPacks?: TechPackListItem[]
  protoRequests?: ProtoRequest[]
  project?: Project
} = {}) {
  const { techPacks = [], protoRequests = [], project = protoProject } = opts
  return stubApi([
    route('GET', PROJECT, { body: project }),
    // Anchored to end: `/tech-packs/:id` (the detail screen) is now a real
    // route too, and must not be intercepted by the *list* endpoint's mock.
    route('GET', /^\/tech-packs$/, { body: techPacks }),
    route('GET', /^\/proto-requests$/, { body: protoRequests }),
    route('GET', `${PROJECT}/members`, { body: [] }),
  ])
}

describe('Project detail', () => {
  it('shows the header facts', async () => {
    stubDetail()
    renderApp(PROJECT, { session: adminSession })

    await screen.findByRole('heading', { name: 'Solar Lantern Proto' })
    expect(screen.getByText('PRJ-000001')).toBeTruthy()
    expect(screen.getByText('Solar Lantern')).toBeTruthy()
    expect(screen.getByText('Proto')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
  })

  it('says so when there are no tech packs or proto requests yet', async () => {
    stubDetail()
    renderApp(PROJECT, { session: adminSession })

    await screen.findByText('No tech packs yet.')
    expect(screen.getByText('No proto requests yet.')).toBeTruthy()
  })

  it('surfaces the API error message when the project is not found', async () => {
    stubApi([route('GET', PROJECT, { status: 404, body: { error: 'Project not found' } })])
    renderApp(PROJECT, { session: adminSession })

    expect((await screen.findByRole('alert')).textContent).toBe('Project not found')
  })

  it('lists tech packs with the active one first, voided ones greyed with a link to their successor', async () => {
    const voided = techPack({
      id: 'tp1',
      code: 'TP-000001',
      voidedAt: '2026-09-05T00:00:00.000Z',
      voidReason: 'wrong BOM',
      createdAt: '2026-09-02T00:00:00.000Z',
    })
    const active = techPack({
      id: 'tp2',
      code: 'TP-000002',
      supersedesId: 'tp1',
      createdAt: '2026-09-06T00:00:00.000Z',
    })
    stubDetail({ techPacks: [voided, active] })
    renderApp(PROJECT, { session: adminSession })

    const items = await screen.findAllByRole('listitem')
    expect(items[0].textContent).toContain('TP-000002')
    expect(items[0].className).not.toContain('muted')
    expect(items[1].textContent).toContain('TP-000001')
    expect(items[1].textContent).toContain('voided')
    expect(items[1].textContent).toContain('superseded by')
    expect(items[1].className).toContain('muted')

    const successorLink = within(items[1]).getByRole('link', { name: 'TP-000002' })
    expect(successorLink.getAttribute('href')).toBe('/tech-packs/tp2')
  })

  it('lists proto requests with links to their own detail page and to their tech pack', async () => {
    stubDetail({ protoRequests: [protoRequest()] })
    renderApp(PROJECT, { session: adminSession })

    await screen.findByText('v1')
    const codeLink = screen.getByRole('link', { name: 'PR-000001' })
    expect(codeLink.getAttribute('href')).toBe('/proto-requests/proto1')
    const techPackLink = screen.getByRole('link', { name: 'TP-000001' })
    expect(techPackLink.getAttribute('href')).toBe('/tech-packs/tp1')
  })
})

describe('Create tech pack form', () => {
  it.each(['PRODUCT_DESIGNER', 'ADMIN'] as const)(
    'is shown to %s when the Project has no active TechPack',
    async (role) => {
      const session = role === 'PRODUCT_DESIGNER' ? productDesignerSession : adminSession
      stubDetail()
      renderApp(PROJECT, { session })

      await screen.findByText('No tech packs yet.')
      expect(screen.getByRole('heading', { name: 'Create tech pack' })).toBeTruthy()
    },
  )

  it.each(
    ALL_SESSIONS.filter(
      (s) =>
        s.user.role !== 'PRODUCT_DESIGNER' &&
        s.user.role !== 'ADMIN' &&
        // FINANCE/MERCHANDISER don't get a "Tech packs" section at all
        // (ADR 0013) - covered separately below.
        s.user.role !== 'FINANCE' &&
        s.user.role !== 'MERCHANDISER',
    ),
  )('is not shown to $user.role, regardless of TechPack state', async (session) => {
    stubDetail()
    renderApp(PROJECT, { session })

    await screen.findByText('No tech packs yet.')
    expect(screen.queryByRole('heading', { name: 'Create tech pack' })).toBeNull()
  })

  it.each(['FINANCE', 'MERCHANDISER'] as const)(
    "%s doesn't get a Tech packs section at all (ADR 0013)",
    async (role) => {
      const session = ALL_SESSIONS.find((s) => s.user.role === role)!
      stubDetail()
      renderApp(PROJECT, { session })

      await screen.findByText('No members yet.')
      expect(screen.queryByRole('heading', { name: 'Tech packs' })).toBeNull()
      expect(screen.queryByText('No tech packs yet.')).toBeNull()
    },
  )

  it('is hidden from an allowed role once the Project has a non-voided TechPack for its phase', async () => {
    stubDetail({ techPacks: [techPack({ voidedAt: null, phase: 'PROTO' })] })
    renderApp(PROJECT, { session: productDesignerSession })

    await screen.findByText('TP-000001')
    expect(screen.queryByRole('heading', { name: 'Create tech pack' })).toBeNull()
  })

  it('is shown again once that TechPack is voided', async () => {
    stubDetail({ techPacks: [techPack({ voidedAt: '2026-09-05T00:00:00.000Z' })] })
    renderApp(PROJECT, { session: productDesignerSession })

    await screen.findByText('TP-000001')
    expect(screen.getByRole('heading', { name: 'Create tech pack' })).toBeTruthy()
  })

  function fileOf(name: string, sizeBytes: number, type = 'application/pdf'): File {
    return new File([new Uint8Array(sizeBytes)], name, { type })
  }

  it('rejects a disallowed file type before sending anything', async () => {
    const api = stubDetail()
    renderApp(PROJECT, { session: productDesignerSession })
    await screen.findByText('No tech packs yet.')

    const input = screen.getByLabelText('Files') as HTMLInputElement
    fireEvent.change(input, { target: { files: [fileOf('malware.exe', 10)] } })

    expect(screen.getByRole('alert').textContent).toMatch(/not allowed/)
    expect(input.value).toBe('')
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('rejects an oversized file before sending anything', async () => {
    const api = stubDetail()
    renderApp(PROJECT, { session: productDesignerSession })
    await screen.findByText('No tech packs yet.')

    const input = screen.getByLabelText('Files') as HTMLInputElement
    fireEvent.change(input, { target: { files: [fileOf('spec.pdf', 26 * 1024 * 1024)] } })

    expect(screen.getByRole('alert').textContent).toMatch(/exceeds the maximum upload size/)
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('cannot be submitted with no file chosen', async () => {
    stubDetail()
    renderApp(PROJECT, { session: productDesignerSession })
    await screen.findByText('No tech packs yet.')

    expect((screen.getByRole('button', { name: 'Create tech pack' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('uploads the chosen files and trimmed notes as multipart, and navigates to the new tech pack', async () => {
    const api = stubApi([
      route('GET', PROJECT, { body: protoProject }),
      route('GET', /^\/tech-packs$/, { body: [] }),
      route('GET', /^\/proto-requests$/, { body: [] }),
      route('GET', `${PROJECT}/members`, { body: [] }),
      route('POST', '/tech-packs', { status: 201, body: techPack() }),
      route('GET', '/tech-packs/tp1', { body: techPackDetail() }),
    ])
    renderApp(PROJECT, { session: productDesignerSession })
    await screen.findByText('No tech packs yet.')

    const file = fileOf('spec.pdf', 1024)
    fireEvent.change(screen.getByLabelText('Files'), { target: { files: [file] } })
    expect(screen.getByText('spec.pdf')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: '  first cut  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create tech pack' }))

    // /tech-packs/tp1 is a real screen now (Screen 3) - landing on its own
    // heading, not just the catch-all, proves the navigation actually fired.
    await screen.findByRole('heading', { name: 'TP-000001' })
    const upload = api.calls.find((c) => c.path === '/tech-packs' && c.method === 'POST')
    expect(upload?.body).toEqual({
      projectId: 'p1',
      notes: 'first cut',
      files: { name: 'spec.pdf', size: 1024, type: 'application/pdf' },
    })
  })

  it('omits notes entirely when left blank', async () => {
    const api = stubApi([
      route('GET', PROJECT, { body: protoProject }),
      route('GET', /^\/tech-packs$/, { body: [] }),
      route('GET', /^\/proto-requests$/, { body: [] }),
      route('GET', `${PROJECT}/members`, { body: [] }),
      route('POST', '/tech-packs', { status: 201, body: techPack() }),
      route('GET', '/tech-packs/tp1', { body: techPackDetail() }),
    ])
    renderApp(PROJECT, { session: productDesignerSession })
    await screen.findByText('No tech packs yet.')

    fireEvent.change(screen.getByLabelText('Files'), { target: { files: [fileOf('spec.pdf', 1024)] } })
    fireEvent.click(screen.getByRole('button', { name: 'Create tech pack' }))

    await screen.findByRole('heading', { name: 'TP-000001' })
    const body = api.calls.find((c) => c.path === '/tech-packs' && c.method === 'POST')?.body
    expect(body).not.toHaveProperty('notes')
  })

  it('shows the API error and does not navigate away when the server refuses', async () => {
    stubApi([
      route('GET', PROJECT, { body: protoProject }),
      route('GET', /^\/tech-packs$/, { body: [] }),
      route('GET', /^\/proto-requests$/, { body: [] }),
      route('GET', `${PROJECT}/members`, { body: [] }),
      route('POST', '/tech-packs', {
        status: 409,
        body: { error: 'Project p1 already has an active Tech Pack' },
      }),
    ])
    renderApp(PROJECT, { session: productDesignerSession })
    await screen.findByText('No tech packs yet.')

    fireEvent.change(screen.getByLabelText('Files'), { target: { files: [fileOf('spec.pdf', 1024)] } })
    fireEvent.click(screen.getByRole('button', { name: 'Create tech pack' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Project p1 already has an active Tech Pack')
    expect(screen.getByRole('heading', { name: 'Create tech pack' })).toBeTruthy()
  })

  it('disables the submit button and shows a busy label while the request is in flight', async () => {
    stubApi([
      route('GET', PROJECT, { body: protoProject }),
      route('GET', /^\/tech-packs$/, { body: [] }),
      route('GET', /^\/proto-requests$/, { body: [] }),
      route('GET', `${PROJECT}/members`, { body: [] }),
      route('POST', '/tech-packs', { status: 201, body: techPack() }),
      route('GET', '/tech-packs/tp1', { body: techPackDetail() }),
    ])
    renderApp(PROJECT, { session: productDesignerSession })
    await screen.findByText('No tech packs yet.')
    fireEvent.change(screen.getByLabelText('Files'), { target: { files: [fileOf('spec.pdf', 1024)] } })

    fireEvent.click(screen.getByRole('button', { name: 'Create tech pack' }))

    const busy = screen.getByRole('button', { name: 'Uploading…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)

    await screen.findByRole('heading', { name: 'TP-000001' }) // let it settle before the next test
  })
})

describe('Team section', () => {
  const member = {
    id: 'm1',
    projectId: 'p1',
    userId: productDesignerUser.id,
    user: productDesignerUser,
    addedById: 'u-pmo',
    addedBy: { ...productDesignerUser, id: 'u-pmo', name: 'Priya PMO', role: 'PMO' as const },
    addedAt: '2026-09-02T00:00:00.000Z',
  }

  it('lists members, with no Remove button for a role that may not manage them', async () => {
    stubApi([
      route('GET', PROJECT, { body: protoProject }),
      route('GET', /^\/tech-packs$/, { body: [] }),
      route('GET', /^\/proto-requests$/, { body: [] }),
      route('GET', `${PROJECT}/members`, { body: [member] }),
    ])
    renderApp(PROJECT, { session: productDesignerSession })

    await screen.findByText('Deepa Designer')
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add a member' })).toBeNull()
  })

  it('lets PMO add a member from the candidates picker', async () => {
    const candidate = { ...productDesignerUser, id: 'u-new', name: 'New Designer' }
    const added = { ...member, userId: candidate.id, user: candidate }
    let members: (typeof member)[] = []
    const api = stubApi([
      route('GET', PROJECT, { body: protoProject }),
      route('GET', /^\/tech-packs$/, { body: [] }),
      route('GET', /^\/proto-requests$/, { body: [] }),
      { method: 'GET', path: `${PROJECT}/members`, respond: () => ({ body: members }) },
      route('GET', `${PROJECT}/members/candidates`, { body: [candidate] }),
      {
        method: 'POST',
        path: `${PROJECT}/members`,
        respond: () => {
          members = [added]
          return { status: 201, body: added }
        },
      },
    ])
    renderApp(PROJECT, { session: pmoSession })
    await screen.findByText('No members yet.')

    fireEvent.click(screen.getByRole('button', { name: 'Add a member' }))
    await screen.findByRole('option', { name: /New Designer/ })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await screen.findByText('New Designer')
    const addCall = api.calls.find((c) => c.path === `${PROJECT}/members` && c.method === 'POST')
    expect(addCall?.body).toEqual({ userId: candidate.id })
  })

  it('lets PMO remove a member', async () => {
    let members: typeof member[] = [member]
    const api = stubApi([
      route('GET', PROJECT, { body: protoProject }),
      route('GET', /^\/tech-packs$/, { body: [] }),
      route('GET', /^\/proto-requests$/, { body: [] }),
      { method: 'GET', path: `${PROJECT}/members`, respond: () => ({ body: members }) },
      {
        method: 'POST',
        path: `${PROJECT}/members/${member.userId}/remove`,
        respond: () => {
          members = []
          return { status: 204 }
        },
      },
    ])
    renderApp(PROJECT, { session: pmoSession })
    await screen.findByText('Deepa Designer')

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await screen.findByText('No members yet.')
    expect(api.calls.some((c) => c.path === `${PROJECT}/members/${member.userId}/remove`)).toBe(true)
  })
})
