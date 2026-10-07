import type { Prisma } from "@prisma/client";

// Excludes passwordHash and passwordChangedAt — nothing that returns a user
// relation should ever leak the hash, and passwordChangedAt is auth-internal
// (see userRepository.findAuthSnapshotById), not something any response needs.
export const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  // The web app needs to know this to force the change-password screen
  // (ADR 0011) - unlike passwordChangedAt, which is purely internal.
  mustChangePassword: true,
  createdAt: true,
} satisfies Prisma.UserSelect;
