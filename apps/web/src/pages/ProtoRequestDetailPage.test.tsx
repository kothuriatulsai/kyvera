import type { ProtoRequest } from '@kyvera/shared-types'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { adminSession, managementUser, productDesignerUser } from '../test/fixtures'
import { route, stubApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

const DETAIL = '/proto-requests/proto1'

function protoRequest(overrides: Partial<ProtoRequest['techPackVersion']> = {}): ProtoRequest {
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
      approval: {
        id: 'ap1',
        techPackVersionId: 'v1',
        decision: 'APPROVED',
        decidedById: managementUser.id,
        decidedBy: managementUser,
        decidedAt: '2026-09-11T00:00:00.000Z',
        notes: null,
      },
      ...overrides,
    },
    createdAt: '2026-09-10T00:00:00.000Z',
  }
}

describe('Proto Request detail', () => {
  it('shows the code, links to the project and tech pack, the pinned version, and who approved it', async () => {
    stubApi([route('GET', DETAIL, { body: protoRequest() })])
    renderApp(DETAIL, { session: adminSession })

    await screen.findByRole('heading', { name: 'PR-000001' })
    expect(screen.getByRole('link', { name: 'Solar Lantern Proto' }).getAttribute('href')).toBe('/projects/p1')
    expect(screen.getByRole('link', { name: 'TP-000001' }).getAttribute('href')).toBe('/tech-packs/tp1')
    expect(screen.getByText('v1')).toBeTruthy()
    expect(screen.getByText(`${managementUser.name} · Sep 11, 2026`)).toBeTruthy()
  })

  it('lists the approved version files as download buttons', async () => {
    const withFile = protoRequest({
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
    stubApi([route('GET', DETAIL, { body: withFile })])
    renderApp(DETAIL, { session: adminSession })

    const button = await screen.findByRole('button', { name: 'spec.pdf' })
    expect(screen.queryByRole('link', { name: 'spec.pdf' })).toBeNull()
    void button
  })

  it('says so when the version has no files', async () => {
    stubApi([route('GET', DETAIL, { body: protoRequest() })])
    renderApp(DETAIL, { session: adminSession })

    await screen.findByText('No files on this version.')
  })

  it('links back to the list', async () => {
    stubApi([route('GET', DETAIL, { body: protoRequest() })])
    renderApp(DETAIL, { session: adminSession })

    const back = await screen.findByRole('link', { name: /All proto requests/ })
    expect(back.getAttribute('href')).toBe('/proto-requests')
  })

  it('surfaces the API error message when the proto request is not found', async () => {
    stubApi([route('GET', DETAIL, { status: 404, body: { error: 'Proto Request not found' } })])
    renderApp(DETAIL, { session: adminSession })

    expect((await screen.findByRole('alert')).textContent).toBe('Proto Request not found')
  })
})
