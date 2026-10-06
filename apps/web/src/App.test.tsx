import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { adminSession } from './test/fixtures'
import { stubApi } from './test/mockApi'
import { renderApp } from './test/renderApp'

describe('unknown routes', () => {
  it('shows the not-found page inside the normal layout, for a logged-in visitor', async () => {
    stubApi([])
    renderApp('/this/path/does/not/exist', { session: adminSession })

    await screen.findByText('Page not found.')
    // The layout around it still renders - this isn't a blank page.
    expect(screen.getByRole('link', { name: 'Projects' })).toBeTruthy()
    expect(screen.getByText('Alex Admin')).toBeTruthy()
  })
})
