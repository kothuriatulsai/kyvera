import type { ProtoRequest } from '@kyvera/shared-types'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { adminSession } from '../test/fixtures'
import { route, stubApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

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

describe('Proto Requests list', () => {
  it('lists proto requests with links to their project and tech pack', async () => {
    stubApi([route('GET', '/proto-requests', { body: [protoRequest()] })])
    renderApp('/proto-requests', { session: adminSession })

    const row = (await screen.findByText('PR-000001')).closest('tr')!
    expect(row.textContent).toContain('v1')

    const codeLink = screen.getByRole('link', { name: 'PR-000001' })
    expect(codeLink.getAttribute('href')).toBe('/proto-requests/proto1')
    const projectLink = screen.getByRole('link', { name: 'Solar Lantern Proto' })
    expect(projectLink.getAttribute('href')).toBe('/projects/p1')
    const techPackLink = screen.getByRole('link', { name: 'TP-000001' })
    expect(techPackLink.getAttribute('href')).toBe('/tech-packs/tp1')
  })

  it('says so when there are no proto requests yet', async () => {
    stubApi([route('GET', '/proto-requests', { body: [] })])
    renderApp('/proto-requests', { session: adminSession })

    await screen.findByText('No proto requests yet.')
  })

  it('surfaces the API error message when the list request fails', async () => {
    stubApi([route('GET', '/proto-requests', { status: 500, body: { error: 'Something broke' } })])
    renderApp('/proto-requests', { session: adminSession })

    expect((await screen.findByRole('alert')).textContent).toBe('Something broke')
  })

  it('is reachable from the nav', async () => {
    stubApi([route('GET', '/proto-requests', { body: [] })])
    renderApp('/', { session: adminSession })

    expect(screen.getByRole('link', { name: 'Proto Requests' }).getAttribute('href')).toBe('/proto-requests')
  })
})
