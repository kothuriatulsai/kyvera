import "dotenv/config";
import { prisma } from "../repositories/prismaClient";
import { hashPassword, isArgon2Hash } from "../services/passwordService";

const DEFAULT_SEED_PASSWORD = "kyvera-dev-password";

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

  // Seeded users can log in with this password. It is dev data — a well-known
  // value in a public repo — so never seed a shared environment with it.
  const seedPasswordHash = await hashPassword(process.env.SEED_USER_PASSWORD ?? DEFAULT_SEED_PASSWORD);

  for (const user of users) {
    const existing = await prisma.user.findUnique({ where: { email: user.email } });

    await prisma.user.upsert({
      where: { email: user.email },
      // Before auth existed the seed stored a plain-text placeholder here.
      // Replace anything that isn't a real hash, but leave a real one alone so
      // re-seeding doesn't reset a password someone deliberately changed.
      update:
        existing && !isArgon2Hash(existing.passwordHash)
          ? { ...user, passwordHash: seedPasswordHash }
          : user,
      create: { ...user, passwordHash: seedPasswordHash },
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
