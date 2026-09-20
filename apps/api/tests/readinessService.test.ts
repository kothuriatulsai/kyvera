import { describe, expect, it } from "vitest";
import { computeReadiness } from "../src/services/readinessService";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-20T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

// Stage durations: 1:5d  2:7d  3:14d  4:3d  5:10d
const stages = [
  { sequenceOrder: 1, expectedDurationDays: 5 },
  { sequenceOrder: 2, expectedDurationDays: 7 },
  { sequenceOrder: 3, expectedDurationDays: 14 },
  { sequenceOrder: 4, expectedDurationDays: 3 },
  { sequenceOrder: 5, expectedDurationDays: 10 },
];

function hint(current: number | null, enteredDaysAgo: number, target: number) {
  return computeReadiness({
    stages,
    currentSequenceOrder: current,
    currentEnteredAt: current === null ? null : daysAgo(enteredDaysAgo),
    targetSequenceOrder: target,
    referenceDate: NOW,
  });
}

describe("computeReadiness", () => {
  it("says a stage before the current one is completed", () => {
    expect(hint(3, 1, 2)).toEqual({ state: "completed", opensInDays: null });
    expect(hint(3, 1, 1)).toEqual({ state: "completed", opensInDays: null });
  });

  it("says the current stage is open now", () => {
    expect(hint(3, 1, 3)).toEqual({ state: "open_now", opensInDays: null });
  });

  it("says the very next stage is up next, once the rest of the current stage has run", () => {
    // Stage 2 has 7 days; 2 have elapsed; 5 remain before stage 3 opens.
    expect(hint(2, 2, 3)).toEqual({ state: "up_next", opensInDays: 5 });
  });

  it("adds the expected duration of every stage in between for a later stage", () => {
    // Stage 2: 5 days remain. Then stage 3 (14) and stage 4 (3) before stage 5.
    expect(hint(2, 2, 5)).toEqual({ state: "upcoming", opensInDays: 5 + 14 + 3 });
  });

  it("counts a current stage that has overrun as having nothing left, not a negative", () => {
    // Stage 2 expected 7 days but it has been 10.
    expect(hint(2, 10, 3)).toEqual({ state: "up_next", opensInDays: 0 });
    expect(hint(2, 10, 4)).toEqual({ state: "upcoming", opensInDays: 14 });
  });

  it("treats a stage after a backward move as upcoming again, not completed", () => {
    // The product was once further along, then sent back to stage 2. Stage 4 has
    // not been reached in *this* run, whatever the history says about an earlier one.
    expect(hint(2, 0, 4)).toEqual({ state: "upcoming", opensInDays: 7 + 14 });
  });

  it("copes with a product that has no current stage yet", () => {
    expect(hint(null, 0, 1)).toEqual({ state: "up_next", opensInDays: 0 });
    expect(hint(null, 0, 3)).toEqual({ state: "upcoming", opensInDays: 5 + 7 });
  });

  it("does not depend on the order the stages are supplied in", () => {
    const shuffled = [...stages].reverse();
    expect(
      computeReadiness({
        stages: shuffled,
        currentSequenceOrder: 2,
        currentEnteredAt: daysAgo(2),
        targetSequenceOrder: 5,
        referenceDate: NOW,
      }),
    ).toEqual({ state: "upcoming", opensInDays: 5 + 14 + 3 });
  });
});
