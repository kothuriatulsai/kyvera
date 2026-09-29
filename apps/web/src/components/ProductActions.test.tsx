import type { ProductDetail, StageAssignment } from '@kyvera/shared-types'
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  adminSession,
  assigneeDetail,
  engineerSession,
  engineerUser,
  lateDelay,
  lateDetail,
  stages,
} from '../test/fixtures'
import { route, stubApi, type MockResult } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

const PRODUCT = '/products/p-x'
const READY = '2026-09-05T00:00:00.000Z'

function detailAt(order: number, assignments: StageAssignment[] = []): ProductDetail {
  const stage = stages[order - 1]
  return {
    ...lateDetail,
    id: 'p-x',
    name: 'Widget X',
    currentStageId: stage.id,
    currentStage: stage,
    assignments,
    progressNotes: [],
  }
}

function assignmentOn(order: number, who: string, ready: boolean): StageAssignment {
  return {
    ...lateDetail.assignments[0],
    id: `a-${who}`,
    productId: 'p-x',
    stageId: stages[order - 1].id,
    stage: stages[order - 1],
    userId: `u-${who}`,
    user: { ...engineerUser, id: `u-${who}`, name: who },
    readyAt: ready ? READY : null,
  }
}

interface State {
  detail: ProductDetail
}

/** The page's data, held in `state` so a transition can genuinely move the product. */
function setup(initial: ProductDetail, onTransition?: (body: unknown, state: State) => MockResult) {
  const state: State = { detail: initial }
  const api = stubApi([
    { method: 'GET', path: PRODUCT, respond: () => ({ body: state.detail }) },
    route('GET', `${PRODUCT}/delay`, { body: lateDelay }),
    route('GET', '/stages', { body: stages }),
    {
      method: 'POST',
      path: `${PRODUCT}/transition`,
      respond: (req) => {
        if (onTransition) return onTransition(req.body, state)
        const body = req.body as { direction?: string; approval?: { decision: string } }
        const backward = body.direction === 'backward' || body.approval?.decision === 'REJECTED'
        state.detail = detailAt(state.detail.currentStage!.sequenceOrder + (backward ? -1 : 1))
        return { body: state.detail }
      },
    },
  ])
  return { api, state }
}

const transitions = (api: ReturnType<typeof setup>['api']) =>
  api.calls.filter((c) => c.method === 'POST' && c.path === `${PRODUCT}/transition`)

const button = (name: string) => screen.getByRole('button', { name })
const maybeButton = (name: string) => screen.queryByRole('button', { name })

async function openAsAdmin() {
  renderApp(PRODUCT, { session: adminSession })
  await screen.findByRole('heading', { name: 'Actions' })
}

// ---------------------------------------------------------------------------

describe('who is offered the controls', () => {
  // One case per control: what the control is, where the product must be for it to
  // apply, and how to tell it is there.
  const controls = [
    { name: 'Advance', stage: 3, present: () => maybeButton('Advance') },
    { name: 'Move back', stage: 3, present: () => maybeButton('Move back') },
    {
      name: 'Approval decision',
      stage: 8,
      present: () => screen.queryByRole('heading', { name: 'Approval decision' }),
    },
  ]

  describe.each(controls)('$name', ({ stage, present }) => {
    it('is shown to someone with authority (the full view)', async () => {
      setup(detailAt(stage))
      await openAsAdmin()
      expect(present()).not.toBeNull()
    })

    it('is not shown to an assignee, who gets the assignee view', async () => {
      // Someone assigned to part of the product: the API sends only their own stage.
      stubApi([
        route('GET', PRODUCT, { body: assigneeDetail({}, { id: 'p-x' }) }),
        route('GET', '/stages', { body: [stages[1]] }),
      ])
      renderApp(PRODUCT, { session: engineerSession })

      await screen.findByRole('heading', { name: 'Assigned Gadget' })
      expect(present()).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Actions' })).toBeNull()
    })

    it('is not shown to someone with no tie to the product, who gets a 404 and no page', async () => {
      stubApi([route('GET', PRODUCT, { status: 404, body: { error: 'Product p-x not found' } })])
      renderApp(PRODUCT, { session: engineerSession })

      await screen.findByRole('alert')
      expect(present()).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Actions' })).toBeNull()
    })
  })

  it('offers no advance button at all to an assignee, only their own "complete this stage"', async () => {
    stubApi([route('GET', PRODUCT, { body: assigneeDetail({}, { id: 'p-x' }) })])
    renderApp(PRODUCT, { session: engineerSession })

    await screen.findByRole('heading', { name: 'Assigned Gadget' })
    expect(maybeButton('Advance')).toBeNull()
    expect(maybeButton('Force advance')).toBeNull()
    expect(maybeButton('Complete this stage')).not.toBeNull() // their own action, unchanged
  })
})

// ---------------------------------------------------------------------------

describe('Advance', () => {
  it.each([
    ['nobody is assigned to the stage', []],
    ['its only assignee has not signed off (they can advance it themselves)', [assignmentOn(3, 'Ann', false)]],
    ['every one of several assignees has signed off', [assignmentOn(3, 'Ann', true), assignmentOn(3, 'Bob', true)]],
  ])('is a plain Advance, with no confirmation and no force flag, when %s', async (_why, assignments) => {
    const { api } = setup(detailAt(3, assignments))
    await openAsAdmin()

    expect(maybeButton('Force advance')).toBeNull()
    fireEvent.click(button('Advance'))

    await screen.findByText(/Currently in Review/)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(transitions(api)).toHaveLength(1)
    // Exactly `{}`: a normal advance carries no `force` at all, not `force: false`.
    expect(transitions(api)[0].body).toEqual({})
  })

  it('becomes Force advance when several assignees have not all signed off', async () => {
    setup(detailAt(3, [assignmentOn(3, 'Ann', true), assignmentOn(3, 'Bob', false)]))
    await openAsAdmin()

    expect(button('Force advance')).toBeTruthy()
    expect(maybeButton('Advance')).toBeNull()
  })

  it('asks first, and says exactly what is being overridden: the count and who', async () => {
    const { api } = setup(
      detailAt(3, [
        assignmentOn(3, 'Ann', true),
        assignmentOn(3, 'Bob', false),
        assignmentOn(3, 'Cy', false),
      ]),
    )
    await openAsAdmin()

    fireEvent.click(button('Force advance'))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText("2 of 3 assignees haven't signed off.")).toBeTruthy()
    expect(dialog.textContent).toContain('Bob, Cy')
    expect(dialog.textContent).not.toContain('Ann') // she has signed off
    // Nothing has been sent yet: the confirmation is a real gate.
    expect(transitions(api)).toHaveLength(0)
  })

  it('counts correctly when nobody has signed off', async () => {
    setup(detailAt(3, [assignmentOn(3, 'Ann', false), assignmentOn(3, 'Bob', false)]))
    await openAsAdmin()

    fireEvent.click(button('Force advance'))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText("2 of 2 assignees haven't signed off.")).toBeTruthy()
  })

  it('does nothing if the confirmation is cancelled', async () => {
    const { api } = setup(detailAt(3, [assignmentOn(3, 'Ann', false), assignmentOn(3, 'Bob', false)]))
    await openAsAdmin()

    fireEvent.click(button('Force advance'))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(button('Force advance')).toBeTruthy()
    expect(transitions(api)).toHaveLength(0)
  })

  it('sends force: true only once confirmed, and the product moves on', async () => {
    const { api } = setup(detailAt(3, [assignmentOn(3, 'Ann', true), assignmentOn(3, 'Bob', false)]))
    await openAsAdmin()

    fireEvent.click(button('Force advance'))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm force advance' }))

    await screen.findByText(/Currently in Review/)
    expect(transitions(api)).toHaveLength(1)
    expect(transitions(api)[0].body).toEqual({ force: true })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('only counts assignees of the current stage, not of later ones', async () => {
    setup(
      detailAt(3, [
        assignmentOn(3, 'Ann', true),
        assignmentOn(5, 'Bob', false), // a later stage: irrelevant to advancing now
        assignmentOn(5, 'Cy', false),
      ]),
    )
    await openAsAdmin()

    expect(button('Advance')).toBeTruthy()
  })

  it('tells you what is at stake at the final stage instead: there is nowhere to advance', async () => {
    setup(detailAt(9))
    await openAsAdmin()

    expect(maybeButton('Advance')).toBeNull()
    expect(maybeButton('Force advance')).toBeNull()
    expect(screen.getByText(/nothing to advance to/i)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Approval decision' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('Move back', () => {
  it('cannot be submitted without a reason, and not with a blank one either', async () => {
    const { api } = setup(detailAt(3))
    await openAsAdmin()

    const submit = button('Move back') as HTMLButtonElement
    const reason = screen.getByLabelText('Reason for moving back')
    expect(submit.disabled).toBe(true)

    fireEvent.change(reason, { target: { value: '   ' } })
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(transitions(api)).toHaveLength(0)

    fireEvent.change(reason, { target: { value: 'spec changed' } })
    expect(submit.disabled).toBe(false)
  })

  it('sends direction "backward" with the trimmed reason, and the product moves back', async () => {
    const { api } = setup(detailAt(3))
    await openAsAdmin()

    fireEvent.change(screen.getByLabelText('Reason for moving back'), {
      target: { value: '  needs a redesign  ' },
    })
    fireEvent.click(button('Move back'))

    await screen.findByText(/Currently in Initial Design/)
    expect(transitions(api)).toHaveLength(1)
    expect(transitions(api)[0].body).toEqual({ direction: 'backward', reason: 'needs a redesign' })
  })

  it('says where it goes and what it resets', async () => {
    setup(detailAt(3))
    await openAsAdmin()

    expect(screen.getByText(/Sends the product back to Initial Design/)).toBeTruthy()
    expect(screen.getByText(/Sign-offs on that stage start again/)).toBeTruthy()
  })

  it('is not offered at the first stage, where there is nothing to go back to', async () => {
    setup(detailAt(1))
    await openAsAdmin()

    expect(maybeButton('Move back')).toBeNull()
    expect(screen.queryByLabelText('Reason for moving back')).toBeNull()
  })

  it('is still offered at the final stage', async () => {
    setup(detailAt(9))
    await openAsAdmin()

    expect(button('Move back')).toBeTruthy()
  })

  it('starts empty again after the product has moved (no reason carried over)', async () => {
    setup(detailAt(3))
    await openAsAdmin()
    fireEvent.change(screen.getByLabelText('Reason for moving back'), { target: { value: 'first' } })
    fireEvent.click(button('Move back'))
    await screen.findByText(/Currently in Initial Design/)

    expect((screen.getByLabelText('Reason for moving back') as HTMLTextAreaElement).value).toBe('')
  })
})

// ---------------------------------------------------------------------------

describe('Approve / Reject', () => {
  const decisionButton = () => screen.getByRole('button', { name: /^(Submit decision|Approve|Reject and move back)$/ }) as HTMLButtonElement
  const choose = (name: 'Approved' | 'Rejected') => fireEvent.click(screen.getByRole('radio', { name }))
  const notes = () => screen.getByLabelText('Notes')

  it('replaces the plain Advance button one step before the final stage', async () => {
    setup(detailAt(8))
    await openAsAdmin()

    expect(screen.getByRole('heading', { name: 'Approval decision' })).toBeTruthy()
    expect(maybeButton('Advance')).toBeNull()
    expect(maybeButton('Force advance')).toBeNull()
  })

  it('is not shown a stage earlier, where a plain Advance applies', async () => {
    setup(detailAt(7))
    await openAsAdmin()

    expect(screen.queryByRole('heading', { name: 'Approval decision' })).toBeNull()
    expect(button('Advance')).toBeTruthy()
  })

  it('makes the consequence of rejecting plain: it moves the product back, not just declines', async () => {
    setup(detailAt(8))
    await openAsAdmin()

    expect(
      screen.getByText(/does not just decline it: it moves the product back one stage to Modification/),
    ).toBeTruthy()
    expect(screen.getByText(/moves the product forward into Approval/)).toBeTruthy()
    // ...and where the decision is recorded.
    expect(screen.getByText(/recorded against v1/)).toBeTruthy()
  })

  it('needs an explicit decision before it can be submitted', async () => {
    setup(detailAt(8))
    await openAsAdmin()

    expect(decisionButton().disabled).toBe(true)
    expect(decisionButton().textContent).toBe('Submit decision')
  })

  it('cannot reject without notes (blank counts as none)', async () => {
    const { api } = setup(detailAt(8))
    await openAsAdmin()

    choose('Rejected')
    expect(decisionButton().disabled).toBe(true)
    fireEvent.change(notes(), { target: { value: '   ' } })
    expect(decisionButton().disabled).toBe(true)
    fireEvent.click(decisionButton())
    expect(transitions(api)).toHaveLength(0)

    fireEvent.change(notes(), { target: { value: 'fails the drop test' } })
    expect(decisionButton().disabled).toBe(false)
  })

  it('can approve without any notes, and sends just the decision', async () => {
    const { api } = setup(detailAt(8))
    await openAsAdmin()

    choose('Approved')
    expect(decisionButton().disabled).toBe(false)
    fireEvent.click(decisionButton())

    await screen.findByText(/Currently in Approval/)
    // No `notes` key when none were given, and no `force` for a fully-clear stage.
    expect(transitions(api)[0].body).toEqual({ approval: { decision: 'APPROVED' } })
  })

  it('sends approval notes when given, trimmed', async () => {
    const { api } = setup(detailAt(8))
    await openAsAdmin()

    choose('Approved')
    fireEvent.change(notes(), { target: { value: '  ship it  ' } })
    fireEvent.click(decisionButton())

    await screen.findByText(/Currently in Approval/)
    expect(transitions(api)[0].body).toEqual({ approval: { decision: 'APPROVED', notes: 'ship it' } })
  })

  it('sends a rejection with its notes, and the product moves back a stage', async () => {
    const { api } = setup(detailAt(8))
    await openAsAdmin()

    choose('Rejected')
    fireEvent.change(notes(), { target: { value: 'fails the drop test' } })
    expect(decisionButton().textContent).toBe('Reject and move back')
    fireEvent.click(decisionButton())

    await screen.findByText(/Currently in Modification/)
    expect(transitions(api)[0].body).toEqual({
      approval: { decision: 'REJECTED', notes: 'fails the drop test' },
    })
  })

  it('asks before approving over an incomplete sign-off, then sends force alongside the decision', async () => {
    const { api } = setup(
      detailAt(8, [
        assignmentOn(8, 'Ann', true),
        assignmentOn(8, 'Bob', false),
        assignmentOn(8, 'Cy', false),
      ]),
    )
    await openAsAdmin()

    choose('Approved')
    fireEvent.click(decisionButton())

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText("2 of 3 assignees haven't signed off.")).toBeTruthy()
    expect(transitions(api)).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm approval' }))

    await screen.findByText(/Currently in Approval/)
    expect(transitions(api)[0].body).toEqual({ approval: { decision: 'APPROVED' }, force: true })
  })

  it('does not ask, or force, when rejecting: a rejection is a backward move', async () => {
    const { api } = setup(
      detailAt(8, [assignmentOn(8, 'Ann', false), assignmentOn(8, 'Bob', false)]),
    )
    await openAsAdmin()

    choose('Rejected')
    fireEvent.change(notes(), { target: { value: 'not good enough' } })
    fireEvent.click(decisionButton())

    await screen.findByText(/Currently in Modification/)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(transitions(api)[0].body).toEqual({
      approval: { decision: 'REJECTED', notes: 'not good enough' },
    })
  })
})

// ---------------------------------------------------------------------------

describe('when the API refuses', () => {
  it('shows a 409 as a visible error, and refreshes the page data', async () => {
    const message = '1 of 2 assignees have not marked this stage ready; pass force: true to advance anyway'
    const { api } = setup(detailAt(3), () => ({ status: 409, body: { error: message } }))
    await openAsAdmin()
    const loadsBefore = api.paths('GET').filter((p) => p === PRODUCT).length

    fireEvent.click(button('Advance'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(message)
    // Still in the same stage, the controls are still there to try again...
    expect(screen.getByText(/Currently in Engineering/)).toBeTruthy()
    expect(button('Advance')).toBeTruthy()
    // ...and the page reloaded, since a 409 usually means sign-offs changed.
    expect(api.paths('GET').filter((p) => p === PRODUCT).length).toBeGreaterThan(loadsBefore)
  })

  it('shows a 403 as a visible error too, not a silent failure', async () => {
    const message = "Only an admin, the product's owner, or a manager assigned to it can move a product backward"
    setup(detailAt(3), () => ({ status: 403, body: { error: message } }))
    await openAsAdmin()

    fireEvent.change(screen.getByLabelText('Reason for moving back'), { target: { value: 'because' } })
    fireEvent.click(button('Move back'))

    expect((await screen.findByRole('alert')).textContent).toBe(message)
  })

  it('closes the force confirmation and shows the error if the forced advance is refused', async () => {
    setup(detailAt(3, [assignmentOn(3, 'Ann', false), assignmentOn(3, 'Bob', false)]), () => ({
      status: 403,
      body: { error: 'Only an admin can force a transition' },
    }))
    await openAsAdmin()

    fireEvent.click(button('Force advance'))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm force advance' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Only an admin can force a transition')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('shows a refused approval as an error and leaves the decision as it was', async () => {
    setup(detailAt(8), () => ({ status: 409, body: { error: 'Something changed' } }))
    await openAsAdmin()

    fireEvent.click(screen.getByRole('radio', { name: 'Approved' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Something changed')
    expect(screen.getByRole('heading', { name: 'Approval decision' })).toBeTruthy()
  })

  it('clears the error when the next attempt is made', async () => {
    let attempts = 0
    setup(detailAt(3), (_body, state) => {
      attempts += 1
      if (attempts === 1) return { status: 409, body: { error: 'Try again' } }
      state.detail = detailAt(4)
      return { body: state.detail }
    })
    await openAsAdmin()

    fireEvent.click(button('Advance'))
    await screen.findByRole('alert')
    fireEvent.click(button('Advance'))

    await screen.findByText(/Currently in Review/)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
