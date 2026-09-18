import { addDays, diffInDays } from "./dateUtils";

export interface StageWindow {
  sequenceOrder: number;
  expectedDurationDays: number;
}

export interface StageVisit {
  stageSequenceOrder: number;
  enteredAt: Date;
  exitedAt: Date | null;
  actualDurationDays: number | null;
}

export interface DelayComputationInput {
  startDate: Date;
  stages: StageWindow[];
  history: StageVisit[];
  /** Defaults to now. Injectable for deterministic testing. */
  referenceDate?: Date;
}

export type StageStatus = "completed" | "in_progress" | "not_started";

export interface StageDelayResult {
  sequenceOrder: number;
  status: StageStatus;
  /** Actual (completed), live elapsed-or-expected (in_progress), or expected (not_started). */
  durationDays: number;
  expectedDurationDays: number;
  delayDays: number;
  delayed: boolean;
}

export interface DelayComputationResult {
  expectedCompletionDate: Date;
  totalDelayDays: number;
  delayed: boolean;
  stages: StageDelayResult[];
}

/**
 * Projects a product's expected completion date from its stage timeline:
 * completed stages contribute their actual duration, the in-progress stage
 * contributes its expected duration (or its live elapsed time once that
 * elapsed time exceeds what was expected — i.e. once it's actually
 * delayed), and stages not yet reached contribute their expected duration.
 * Only real, observed delay cascades forward; stages not yet reached are
 * assumed on-schedule until proven otherwise.
 */
export function computeProductDelay(input: DelayComputationInput): DelayComputationResult {
  const referenceDate = input.referenceDate ?? new Date();
  const sortedStages = [...input.stages].sort((a, b) => a.sequenceOrder - b.sequenceOrder);

  const latestVisitByStage = new Map<number, StageVisit>();
  for (const visit of input.history) {
    const existing = latestVisitByStage.get(visit.stageSequenceOrder);
    if (!existing || visit.enteredAt > existing.enteredAt) {
      latestVisitByStage.set(visit.stageSequenceOrder, visit);
    }
  }

  const stages: StageDelayResult[] = sortedStages.map((stage) => {
    const visit = latestVisitByStage.get(stage.sequenceOrder);

    let status: StageStatus;
    let durationDays: number;

    if (!visit) {
      status = "not_started";
      durationDays = stage.expectedDurationDays;
    } else if (visit.exitedAt) {
      status = "completed";
      durationDays = visit.actualDurationDays ?? diffInDays(visit.enteredAt, visit.exitedAt);
    } else {
      status = "in_progress";
      const elapsedDays = diffInDays(visit.enteredAt, referenceDate);
      durationDays = Math.max(stage.expectedDurationDays, elapsedDays);
    }

    const delayDays = Math.max(0, durationDays - stage.expectedDurationDays);

    return {
      sequenceOrder: stage.sequenceOrder,
      status,
      durationDays,
      expectedDurationDays: stage.expectedDurationDays,
      delayDays,
      delayed: delayDays > 0,
    };
  });

  const totalDurationDays = stages.reduce((sum, stage) => sum + stage.durationDays, 0);
  const totalDelayDays = stages.reduce((sum, stage) => sum + stage.delayDays, 0);

  return {
    expectedCompletionDate: addDays(input.startDate, totalDurationDays),
    totalDelayDays,
    delayed: totalDelayDays > 0,
    stages,
  };
}
