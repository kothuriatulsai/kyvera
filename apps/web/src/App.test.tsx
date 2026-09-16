import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the Kyvera heading', () => {
    render(<App />)
    const heading = screen.getByRole('heading', { name: 'Kyvera' })

    expect(heading.textContent).toBe('Kyvera')
  })
})
