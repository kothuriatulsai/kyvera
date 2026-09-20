import { diffInDays } from "./dateUtils";

export type ReadinessState = "completed" | "open_now" | "up_next" | "upcoming";

/**
 * What an assignee is told about *when* their stage happens, without being told
 * anything about the rest of the workflow (docs/architecture/0004, Resolution
 * 1). `opensInDays` is only set while the stage hasn't opened yet.
 */
export interface ReadinessHint {
  state: ReadinessState;
  opensInDays: number | null;
}

export interface ReadinessInput {
  stages: { sequenceOrder: number; expectedDurationDays: number }[];
  /** The product's current stage; null if it somehow has none. */
  currentSequenceOrder: number | null;
  /** When the product entered its current stage (the open history entry). */
  currentEnteredAt: Date | null;
  /** The stage the hint is for. */
  targetSequenceOrder: number;
  /** Defaults to now. Injectable for deterministic testing. */
  referenceDate?: Date;
}

/**
 * Pure function over the *full* stage list and history — the caller filters
 * only what is shown, never what is computed, so the lead time is right even
 * though the assignee can't see the stages it's made of.
 *
 * A stage before the current one is completed, the current one is open, and a
 * later one opens after the rest of the current stage plus the expected
 * duration of everything in between. Only the current stage's real elapsed
 * time is known; stages not reached yet are assumed on schedule, the same
 * model the delay projection uses.
 */
export function computeReadiness(input: ReadinessInput): ReadinessHint {
  const referenceDate = input.referenceDate ?? new Date();
  const sorted = [...input.stages].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  const { currentSequenceOrder, targetSequenceOrder } = input;

  if (currentSequenceOrder !== null) {
    if (targetSequenceOrder < currentSequenceOrder) {
      return { state: "completed", opensInDays: null };
    }
    if (targetSequenceOrder === currentSequenceOrder) {
      return { state: "open_now", opensInDays: null };
    }
  }

  // Days until the current stage is expected to finish (0 if it has overrun).
  let opensInDays = 0;
  let afterOrder = 0;
  if (currentSequenceOrder !== null) {
    const current = sorted.find((s) => s.sequenceOrder === currentSequenceOrder);
    const elapsed = input.currentEnteredAt ? diffInDays(input.currentEnteredAt, referenceDate) : 0;
    opensInDays += Math.max(0, (current?.expectedDurationDays ?? 0) - elapsed);
    afterOrder = currentSequenceOrder;
  }

  // Plus everything strictly between the current stage and the target.
  const between = sorted.filter(
    (s) => s.sequenceOrder > afterOrder && s.sequenceOrder < targetSequenceOrder,
  );
  opensInDays += between.reduce((sum, s) => sum + s.expectedDurationDays, 0);

  return { state: between.length === 0 ? "up_next" : "upcoming", opensInDays };
}
