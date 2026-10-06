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
  createdAt: true,
} satisfies Prisma.UserSelect;
