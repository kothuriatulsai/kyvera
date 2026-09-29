import type { StageAssignment } from '@kyvera/shared-types'
import { describe, expect, it } from 'vitest'
import { currentStageSignOff, describePending, stagePosition } from './transitions'
import { engineerUser, stages } from '../test/fixtures'

function assignment(id: string, stageId: string, readyAt: string | null): StageAssignment {
  return {
    id,
    productId: 'p',
    stageId,
    stage: stages.find((s) => s.id === stageId)!,
    userId: `u-${id}`,
    user: { ...engineerUser, id: `u-${id}`, name: `Person ${id}` },
    assignedAt: '2026-09-01T00:00:00.000Z',
    assignedById: 'u-admin',
    assignedBy: engineerUser,
    readyAt,
  }
}

const READY = '2026-09-05T00:00:00.000Z'

describe('currentStageSignOff', () => {
  it('needs no force when there is nobody assigned to the current stage', () => {
    const signOff = currentStageSignOff({ currentStageId: 's2', assignments: [] })
    expect(signOff).toMatchObject({ total: 0, signedOff: 0, needsForce: false })
  })

  it('needs no force for a single assignee, signed off or not (they can advance it themselves)', () => {
    for (const readyAt of [null, READY]) {
      const signOff = currentStageSignOff({
        currentStageId: 's2',
        assignments: [assignment('a', 's2', readyAt)],
      })
      expect(signOff.needsForce, `readyAt=${readyAt}`).toBe(false)
    }
  })

  it('needs no force once every one of several assignees has signed off', () => {
    const signOff = currentStageSignOff({
      currentStageId: 's2',
      assignments: [assignment('a', 's2', READY), assignment('b', 's2', READY)],
    })
    expect(signOff).toMatchObject({ total: 2, signedOff: 2, needsForce: false })
    expect(signOff.pending).toEqual([])
  })

  it('needs force, and counts who is missing, when several assignees are not all ready', () => {
    const signOff = currentStageSignOff({
      currentStageId: 's2',
      assignments: [
        assignment('a', 's2', READY),
        assignment('b', 's2', null),
        assignment('c', 's2', null),
      ],
    })
    expect(signOff).toMatchObject({ total: 3, signedOff: 1, needsForce: true })
    expect(signOff.pending.map((p) => p.user.name)).toEqual(['Person b', 'Person c'])
    expect(describePending(signOff)).toBe("2 of 3 assignees haven't signed off")
  })

  it("counts only the current stage's assignments, not other stages'", () => {
    const signOff = currentStageSignOff({
      currentStageId: 's2',
      assignments: [
        assignment('a', 's2', READY),
        assignment('b', 's2', READY),
        assignment('x', 's4', null), // a later stage, still to come
        assignment('y', 's4', null),
      ],
    })
    expect(signOff).toMatchObject({ total: 2, signedOff: 2, needsForce: false })
  })
})

describe('stagePosition', () => {
  it('finds the stages either side of the current one', () => {
    const position = stagePosition('s3', stages)
    expect(position.current?.name).toBe('Engineering')
    expect(position.next?.name).toBe('Review')
    expect(position.previous?.name).toBe('Initial Design')
    expect(position.enteringFinal).toBe(false)
    expect(position.atFinal).toBe(false)
  })

  it('has no previous stage at the start', () => {
    const position = stagePosition('s1', stages)
    expect(position.previous).toBeNull()
    expect(position.next?.name).toBe('Initial Design')
  })

  it('knows the final stage by its position (highest order), not by its name', () => {
    expect(stagePosition('s1', stages).final?.sequenceOrder).toBe(9)
    // Rename every stage: the answer must not change.
    const renamed = stages.map((s) => ({ ...s, name: `Stage ${s.sequenceOrder}` }))
    expect(stagePosition('s8', renamed).enteringFinal).toBe(true)
  })

  it('is one step from the final stage only at the stage before it', () => {
    expect(stagePosition('s7', stages).enteringFinal).toBe(false)
    const position = stagePosition('s8', stages)
    expect(position.enteringFinal).toBe(true)
    expect(position.next?.name).toBe('Approval')
    expect(position.previous?.name).toBe('Modification')
  })

  it('has nothing to advance to at the final stage', () => {
    const position = stagePosition('s9', stages)
    expect(position.atFinal).toBe(true)
    expect(position.next).toBeNull()
    expect(position.enteringFinal).toBe(false)
  })

  it('copes with a product that has no current stage', () => {
    expect(stagePosition(null, stages)).toMatchObject({ current: null, next: null, previous: null })
  })
})
