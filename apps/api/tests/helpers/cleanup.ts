import { prisma } from "../../src/repositories/prismaClient";
import { attachmentStorage } from "../../src/services/storage";
import { cleanupTestUsers } from "./auth";

/**
 * The FK-respecting teardown every SOP test file needs, now one level
 * deeper than before Slice B (ADR 0015): a TechPack's chain can run all the
 * way down through a confirmed ProtoRequest into a ProtoWork and its own
 * children, and a PO is an Attachment owned by the ProtoRequest rather than
 * the TechPackVersion. Centralized here (rather than copy-pasted per file,
 * the pre-Slice-B convention) because the chain got long enough that
 * duplicating it five times risked getting the order wrong in one copy.
 */
export async function cleanupSopFixtures(opts: {
  projectIds: string[];
  techPackIds: string[];
  manufacturerIds?: string[];
}) {
  const { projectIds, techPackIds, manufacturerIds = [] } = opts;

  const tpAttachments = await prisma.attachment.findMany({
    where: { techPackVersion: { techPackId: { in: techPackIds } } },
    select: { id: true, storageKey: true },
  });
  const poAttachments = await prisma.attachment.findMany({
    where: { protoRequest: { techPackVersion: { techPackId: { in: techPackIds } } } },
    select: { id: true, storageKey: true },
  });
  const allAttachments = [...tpAttachments, ...poAttachments];
  await prisma.attachment.deleteMany({ where: { id: { in: allAttachments.map((a) => a.id) } } });
  await Promise.all(allAttachments.map((a) => attachmentStorage.delete(a.storageKey)));

  await prisma.protoWorkUpdate.deleteMany({
    where: { protoWork: { protoRequest: { techPackVersion: { techPackId: { in: techPackIds } } } } },
  });
  await prisma.protoWorkDeliveryConfirmation.deleteMany({
    where: { protoWork: { protoRequest: { techPackVersion: { techPackId: { in: techPackIds } } } } },
  });
  await prisma.protoWork.deleteMany({
    where: { protoRequest: { techPackVersion: { techPackId: { in: techPackIds } } } },
  });
  await prisma.protoRequest.deleteMany({
    where: { techPackVersion: { techPackId: { in: techPackIds } } },
  });
  await prisma.techPackRemark.deleteMany({ where: { techPackVersion: { techPackId: { in: techPackIds } } } });
  await prisma.techPackConfirmation.deleteMany({
    where: { techPackVersion: { techPackId: { in: techPackIds } } },
  });
  await prisma.techPackApproval.deleteMany({
    where: { techPackVersion: { techPackId: { in: techPackIds } } },
  });
  await prisma.techPackVersion.deleteMany({ where: { techPackId: { in: techPackIds } } });
  // Successors (supersedesId set) first - two separate statements so a
  // superseded TechPack and its successor in the same `in` list don't race
  // their own self-referencing FK.
  await prisma.techPack.deleteMany({ where: { id: { in: techPackIds }, supersedesId: { not: null } } });
  await prisma.techPack.deleteMany({ where: { id: { in: techPackIds } } });

  await prisma.projectMemberHistory.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });

  // After every ProtoRequest that referenced one is gone (above).
  await prisma.manufacturerMaster.deleteMany({ where: { id: { in: manufacturerIds } } });

  await cleanupTestUsers();
  await prisma.$disconnect();
}
