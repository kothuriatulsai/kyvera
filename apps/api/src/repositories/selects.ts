import type { Prisma } from "@prisma/client";

// Excludes passwordHash — nothing that returns a user relation should ever
// leak it, placeholder value or not.
export const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;
