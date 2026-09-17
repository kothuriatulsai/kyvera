import "dotenv/config";
import { prisma } from "../repositories/prismaClient";

// Placeholder durations — tune once real stage timing data exists.
const stages = [
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

// No auth module yet (that's a separate build item), so there's no real
// password hashing to seed either — these exist only so product CRUD has
// user ids to reference for ownerId/createdById/responsibleUserId.
const users = [
  { email: "owner@kyvera.dev", name: "Dana Owner", role: "MANAGER" as const },
  { email: "engineer@kyvera.dev", name: "Eli Engineer", role: "ENGINEER" as const },
  { email: "finance@kyvera.dev", name: "Fran Finance", role: "FINANCE" as const },
  { email: "admin@kyvera.dev", name: "Alex Admin", role: "ADMIN" as const },
];

async function main() {
  for (const stage of stages) {
    await prisma.stageDefinition.upsert({
      where: { sequenceOrder: stage.sequenceOrder },
      update: stage,
      create: stage,
    });
  }

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: user,
      create: { ...user, passwordHash: "unset-no-auth-module-yet" },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
