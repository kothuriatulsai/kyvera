import { describe, expect, it } from "vitest";
import { computeProductDelay, type StageVisit, type StageWindow } from "../src/services/delayComputationService";

const STAGES: StageWindow[] = [
  { sequenceOrder: 1, expectedDurationDays: 5 },
  { sequenceOrder: 2, expectedDurationDays: 7 },
  { sequenceOrder: 3, expectedDurationDays: 3 },
];

const START_DATE = new Date("2026-01-01T00:00:00.000Z");

function daysAfterStart(days: number): Date {
  return new Date(START_DATE.getTime() + days * 24 * 60 * 60 * 1000);
}

describe("computeProductDelay", () => {
  it("projects the full on-schedule timeline when no stage has been entered yet", () => {
    const result = computeProductDelay({
      startDate: START_DATE,
      stages: STAGES,
      history: [],
      referenceDate: START_DATE,
    });

    // 5 + 7 + 3 = 15 days, nothing delayed
    expect(result.expectedCompletionDate).toEqual(daysAfterStart(15));
    expect(result.delayed).toBe(false);
    expect(result.totalDelayDays).toBe(0);
    expect(result.stages.every((s) => s.status === "not_started")).toBe(true);
  });

  it("uses the actual duration for a completed stage that finished early", () => {
    const history: StageVisit[] = [
      {
        stageSequenceOrder: 1,
        enteredAt: START_DATE,
        exitedAt: daysAfterStart(3),
        actualDurationDays: 3,
      },
    ];

    const result = computeProductDelay({
      startDate: START_DATE,
      stages: STAGES,
      history,
      referenceDate: daysAfterStart(3),
    });

    // 3 (actual, early) + 7 (projected) + 3 (projected) = 13
    expect(result.expectedCompletionDate).toEqual(daysAfterStart(13));
    expect(result.delayed).toBe(false);
    expect(result.stages[0]).toMatchObject({ status: "completed", durationDays: 3, delayed: false });
  });

  it("cascades a completed stage's overage forward onto the expected completion date", () => {
    const history: StageVisit[] = [
      {
        stageSequenceOrder: 1,
        enteredAt: START_DATE,
        exitedAt: daysAfterStart(8),
        actualDurationDays: 8, // 3 days over the 5-day expectation
      },
    ];

    const result = computeProductDelay({
      startDate: START_DATE,
      stages: STAGES,
      history,
      referenceDate: daysAfterStart(8),
    });

    // 8 (actual, delayed) + 7 (projected) + 3 (projected) = 18
    expect(result.expectedCompletionDate).toEqual(daysAfterStart(18));
    expect(result.delayed).toBe(true);
    expect(result.totalDelayDays).toBe(3);
    expect(result.stages[0]).toMatchObject({ status: "completed", delayDays: 3, delayed: true });
  });

  it("projects an in-progress stage at its expected duration while still on schedule", () => {
    const history: StageVisit[] = [
      { stageSequenceOrder: 1, enteredAt: START_DATE, exitedAt: null, actualDurationDays: null },
    ];

    const result = computeProductDelay({
      startDate: START_DATE,
      stages: STAGES,
      history,
      referenceDate: daysAfterStart(2), // only 2 of the 5 expected days elapsed
    });

    // Still projected as 5 (on schedule) + 7 + 3 = 15, even though only 2 days have passed
    expect(result.expectedCompletionDate).toEqual(daysAfterStart(15));
    expect(result.delayed).toBe(false);
    expect(result.stages[0]).toMatchObject({ status: "in_progress", durationDays: 5, delayed: false });
  });

  it("cascades an in-progress stage's live overage once it runs past its expected duration", () => {
    const history: StageVisit[] = [
      { stageSequenceOrder: 1, enteredAt: START_DATE, exitedAt: null, actualDurationDays: null },
    ];

    const result = computeProductDelay({
      startDate: START_DATE,
      stages: STAGES,
      history,
      referenceDate: daysAfterStart(9), // 4 days past the 5-day expectation
    });

    // 9 (elapsed, delayed) + 7 (projected) + 3 (projected) = 19
    expect(result.expectedCompletionDate).toEqual(daysAfterStart(19));
    expect(result.delayed).toBe(true);
    expect(result.totalDelayDays).toBe(4);
    expect(result.stages[0]).toMatchObject({ status: "in_progress", durationDays: 9, delayDays: 4 });
  });

  it("uses only the most recent visit to a stage that was re-entered after moving backward", () => {
    const history: StageVisit[] = [
      // First pass through stage 1 ran long...
      {
        stageSequenceOrder: 1,
        enteredAt: START_DATE,
        exitedAt: daysAfterStart(5),
        actualDurationDays: 5,
      },
      // ...product moved to stage 2, then back to stage 1 for rework, entered later
      {
        stageSequenceOrder: 1,
        enteredAt: daysAfterStart(6),
        exitedAt: daysAfterStart(8),
        actualDurationDays: 2,
      },
    ];

    const result = computeProductDelay({
      startDate: START_DATE,
      stages: STAGES,
      history,
      referenceDate: daysAfterStart(8),
    });

    const stage1 = result.stages.find((s) => s.sequenceOrder === 1);
    expect(stage1).toMatchObject({ status: "completed", durationDays: 2, delayed: false });
  });

  it("sums delay across multiple delayed stages", () => {
    const history: StageVisit[] = [
      {
        stageSequenceOrder: 1,
        enteredAt: START_DATE,
        exitedAt: daysAfterStart(7),
        actualDurationDays: 7, // 2 over
      },
      {
        stageSequenceOrder: 2,
        enteredAt: daysAfterStart(7),
        exitedAt: daysAfterStart(17),
        actualDurationDays: 10, // 3 over
      },
    ];

    const result = computeProductDelay({
      startDate: START_DATE,
      stages: STAGES,
      history,
      referenceDate: daysAfterStart(17),
    });

    expect(result.totalDelayDays).toBe(5);
    expect(result.delayed).toBe(true);
    // 7 + 10 + 3 (projected) = 20
    expect(result.expectedCompletionDate).toEqual(daysAfterStart(20));
  });
});
