import "dotenv/config";
import { prisma } from "../repositories/prismaClient";
import { hashPassword, isArgon2Hash } from "../services/passwordService";

const DEFAULT_SEED_PASSWORD = "kyvera-dev-password";

// One user per final role (ADR 0010). Accounts come only from this seed for
// now - there is no self-registration or admin "create user" endpoint yet.
const users = [
  { email: "admin@kyvera.dev", name: "Alex Admin", role: "ADMIN" as const },
  { email: "finance@kyvera.dev", name: "Fran Finance", role: "FINANCE" as const },
  { email: "pmo@kyvera.dev", name: "Priya PMO", role: "PMO" as const },
  { email: "designer@kyvera.dev", name: "Deepa Designer", role: "PRODUCT_DESIGNER" as const },
  { email: "engineering@kyvera.dev", name: "Emre Engineering", role: "ENGINEERING" as const },
  { email: "management@kyvera.dev", name: "Mira Management", role: "MANAGEMENT" as const },
  { email: "merchandiser@kyvera.dev", name: "Milo Merchandiser", role: "MERCHANDISER" as const },
];

async function main() {
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
