import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { adminUser, engineerUser, ownerUser } from '../test/fixtures'
import { AssigneesCell } from './AssigneesCell'

const ann = { ...engineerUser, id: 'u-ann', name: 'Ann Assignee' }
const bob = { ...engineerUser, id: 'u-bob', name: 'Bob Builder' }
const cy = { ...engineerUser, id: 'u-cy', name: 'Cy Checker' }

const infoButton = () => screen.getByRole('button', { name: /show all \d+ assignees of Engineering/i })

describe('AssigneesCell', () => {
  it('shows a single assignee by name, with no popover button', () => {
    render(<AssigneesCell stageName="Engineering" assignees={[ann]} fallback={null} />)

    expect(screen.getByText('Ann Assignee')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows "Multiple" and an info button when several people are assigned', () => {
    render(<AssigneesCell stageName="Engineering" assignees={[ann, bob, cy]} fallback={null} />)

    expect(screen.getByText(/Multiple/)).toBeTruthy()
    expect(infoButton().getAttribute('aria-label')).toBe('Show all 3 assignees of Engineering')
    // The names stay hidden until it is pressed.
    expect(screen.queryByText('Ann Assignee')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists every assignee in a popover when the icon is pressed', () => {
    render(<AssigneesCell stageName="Engineering" assignees={[ann, bob, cy]} fallback={null} />)

    fireEvent.click(infoButton())

    const popover = screen.getByRole('dialog', { name: 'Assignees of Engineering' })
    expect(within(popover).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Ann Assignee',
      'Bob Builder',
      'Cy Checker',
    ])
    expect(infoButton().getAttribute('aria-expanded')).toBe('true')
  })

  it('closes when the icon is pressed again', () => {
    render(<AssigneesCell stageName="Engineering" assignees={[ann, bob]} fallback={null} />)

    fireEvent.click(infoButton())
    fireEvent.click(infoButton())

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(infoButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Escape', () => {
    render(<AssigneesCell stageName="Engineering" assignees={[ann, bob]} fallback={null} />)

    fireEvent.click(infoButton())
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes when you click somewhere else, but not when you click inside it', () => {
    render(
      <div>
        <p>elsewhere</p>
        <AssigneesCell stageName="Engineering" assignees={[ann, bob]} fallback={null} />
      </div>,
    )

    fireEvent.click(infoButton())
    fireEvent.mouseDown(within(screen.getByRole('dialog')).getByText('Ann Assignee'))
    expect(screen.queryByRole('dialog')).not.toBeNull() // inside: stays open

    fireEvent.mouseDown(screen.getByText('elsewhere'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('falls back to whoever was recorded as responsible when nobody is assigned', () => {
    render(<AssigneesCell stageName="Engineering" assignees={[]} fallback={ownerUser} />)

    expect(screen.getByText('Dana Owner')).toBeTruthy()
  })

  it('prefers the assignees over the recorded responsible person', () => {
    render(<AssigneesCell stageName="Engineering" assignees={[ann]} fallback={adminUser} />)

    expect(screen.getByText('Ann Assignee')).toBeTruthy()
    expect(screen.queryByText('Alex Admin')).toBeNull()
  })

  it('shows a dash when there is nobody at all', () => {
    render(<AssigneesCell stageName="Engineering" assignees={[]} fallback={null} />)

    expect(screen.getByText('—')).toBeTruthy()
  })
})
