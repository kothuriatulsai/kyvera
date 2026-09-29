import type { ProductDetail, StageAssignment, StageDefinition } from '@kyvera/shared-types'

/**
 * Where a product stands on sign-off for the stage it is in now. This mirrors the
 * server's rule (`stageTransitionService`): only a stage with SEVERAL assignees
 * needs everyone's sign-off before it can be advanced without `force`. A stage with
 * one assignee, or none, can always be advanced by someone with authority.
 *
 * It is worked out from the assignments the page already has, so it can be stale by
 * the time someone clicks; the server re-checks and answers 409 if so.
 */
export interface SignOff {
  total: number
  signedOff: number
  /** Assignees on the current stage who have not marked themselves ready. */
  pending: StageAssignment[]
  needsForce: boolean
}

export function currentStageSignOff(
  product: Pick<ProductDetail, 'assignments' | 'currentStageId'>,
): SignOff {
  const onStage = product.assignments.filter((a) => a.stageId === product.currentStageId)
  const pending = onStage.filter((a) => a.readyAt === null)

  return {
    total: onStage.length,
    signedOff: onStage.length - pending.length,
    pending,
    needsForce: onStage.length > 1 && pending.length > 0,
  }
}

/** "2 of 3 assignees haven't signed off" - the concrete thing a force overrides. */
export function describePending(signOff: SignOff): string {
  return `${signOff.pending.length} of ${signOff.total} assignees haven't signed off`
}

/**
 * The stages around the product's current one. "Next" and "previous" are exactly
 * one `sequenceOrder` away, as on the server (a transition is always one step, and
 * can't skip). The final stage is the one with the highest `sequenceOrder`: that is
 * the approval gate (ADR 0005), found by position rather than by name.
 */
export interface StagePosition {
  current: StageDefinition | null
  next: StageDefinition | null
  previous: StageDefinition | null
  final: StageDefinition | null
  /** One forward step from the final stage: moving forward needs an approval decision. */
  enteringFinal: boolean
  atFinal: boolean
}

export function stagePosition(
  currentStageId: string | null,
  stages: StageDefinition[],
): StagePosition {
  const current = stages.find((s) => s.id === currentStageId) ?? null
  const final = stages.reduce<StageDefinition | null>(
    (highest, s) => (highest === null || s.sequenceOrder > highest.sequenceOrder ? s : highest),
    null,
  )

  const at = (order: number) => stages.find((s) => s.sequenceOrder === order) ?? null
  const next = current ? at(current.sequenceOrder + 1) : null
  const previous = current ? at(current.sequenceOrder - 1) : null

  return {
    current,
    next,
    previous,
    final,
    enteringFinal: next !== null && final !== null && next.id === final.id,
    atFinal: current !== null && final !== null && current.id === final.id,
  }
}
