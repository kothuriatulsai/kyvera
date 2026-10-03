// Shared between the dev seed (seed.ts) and the test database's own minimal
// seed (tests/globalSetup.ts) - both need the exact same stage_definitions
// rows, and only one of them should own the data.

// Placeholder durations — tune once real stage timing data exists.
export const stageDefinitionSeedData = [
  { sequenceOrder: 1, name: "Requirement", expectedDurationDays: 5 },
  { sequenceOrder: 2, name: "Initial Design", expectedDurationDays: 7 },
  { sequenceOrder: 3, name: "Engineering", expectedDurationDays: 14 },
  { sequenceOrder: 4, name: "Review", expectedDurationDays: 3 },
  { sequenceOrder: 5, name: "Prototype", expectedDurationDays: 10 },
  { sequenceOrder: 6, name: "Testing", expectedDurationDays: 7 },
  { sequenceOrder: 7, name: "Modification", expectedDurationDays: 5 },
  { sequenceOrder: 8, name: "Final Review", expectedDurationDays: 3 },
  { sequenceOrder: 9, name: "Approval", expectedDurationDays: 2 },
];
