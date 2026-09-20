import type { ProductStatus } from "@prisma/client";
import * as productRepository from "../repositories/productRepository";
import * as productVersionRepository from "../repositories/productVersionRepository";
import * as productStageHistoryRepository from "../repositories/productStageHistoryRepository";
import * as stageDefinitionRepository from "../repositories/stageDefinitionRepository";
import * as userRepository from "../repositories/userRepository";
import { prisma } from "../repositories/prismaClient";
import { requireAccess, requireAuthority } from "./accessService";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";
import {
  computeDelayForProduct,
  deriveStatus,
  recomputeAndPersistProductDelay,
} from "./productDelayService";
import type { Actor } from "./tokenService";

export interface CreateProductInput {
  name: string;
  description?: string;
  ownerId: string;
  spec?: string;
  startDate?: Date;
  expectedCompletionDate?: Date;
}

export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  ownerId?: string;
  status?: ProductStatus;
  expectedCompletionDate?: Date | null;
  actualCompletionDate?: Date | null;
}

export interface CreateProductVersionInput {
  spec?: string;
  createdById?: string;
}

export async function createProduct(input: CreateProductInput) {
  const owner = await userRepository.findById(input.ownerId);
  if (!owner) {
    throw new ValidationError(`ownerId ${input.ownerId} does not reference an existing user`);
  }

  const firstStage = await stageDefinitionRepository.findFirst();
  if (!firstStage) {
    throw new ConflictError(
      "No workflow stages are configured — seed stage_definitions before creating products.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const product = await productRepository.create(
      {
        name: input.name,
        description: input.description,
        owner: { connect: { id: input.ownerId } },
        currentStage: { connect: { id: firstStage.id } },
        currentVersion: 1,
        startDate: input.startDate ?? new Date(),
        expectedCompletionDate: input.expectedCompletionDate,
      },
      tx,
    );

    await productVersionRepository.create(
      {
        product: { connect: { id: product.id } },
        versionNumber: 1,
        spec: input.spec,
        createdBy: { connect: { id: input.ownerId } },
      },
      tx,
    );

    await productStageHistoryRepository.create(
      {
        product: { connect: { id: product.id } },
        stage: { connect: { id: firstStage.id } },
        responsibleUser: { connect: { id: input.ownerId } },
      },
      tx,
    );

    // Only auto-project the completion date when the caller didn't set an
    // explicit target — an explicit expectedCompletionDate at creation time
    // is a manually-set goal, not something step 4's cascade should override
    // before any stage timing has actually happened.
    if (input.expectedCompletionDate === undefined) {
      await recomputeAndPersistProductDelay(product.id, tx);
    }

    const created = await productRepository.findById(product.id, tx);
    if (!created) {
      throw new ConflictError(`Product ${product.id} disappeared while it was being created`);
    }
    return created;
  });
}

// status is derived from the delay computation (see productDelayService), so
// the only legitimate manual write is BLOCKED. Anything else used to be
// accepted and silently overridden on the next read; reject it instead.
//
// The one exception is ON_TRACK on a BLOCKED product, which means "clear the
// block". Without it a BLOCKED product could never be unblocked, since BLOCKED
// always wins over the derived value. The stored value is then set to what the
// delay computation says (ON_TRACK or DELAYED), never to the raw value sent.
async function resolveManualStatus(
  productId: string,
  current: ProductStatus,
  requested: ProductStatus | undefined,
): Promise<ProductStatus | undefined> {
  if (requested === undefined || requested === "BLOCKED") return requested;

  if (requested === "ON_TRACK" && current === "BLOCKED") {
    const delay = await computeDelayForProduct(productId);
    return deriveStatus("ON_TRACK", delay.delayed);
  }

  throw new ValidationError(
    "status is derived from delay computation; only BLOCKED can be set manually" +
      " (ON_TRACK is accepted only to clear a BLOCKED status)",
  );
}

export async function updateProduct(actor: Actor, id: string, input: UpdateProductInput) {
  const { product: existing, access } = await requireAccess(actor, id);
  requireAuthority(access, "edit this product");

  // Ownership is what grants local-admin authority over a product, so handing
  // it to someone (or to yourself) is a user/assignment-level change: admin only.
  // ADR 0004 reserves those for admins but doesn't mention ownership explicitly.
  if (input.ownerId !== undefined && actor.role !== "ADMIN") {
    throw new ForbiddenError("Only an admin can change a product's owner");
  }

  if (input.ownerId) {
    const owner = await userRepository.findById(input.ownerId);
    if (!owner) {
      throw new ValidationError(`ownerId ${input.ownerId} does not reference an existing user`);
    }
  }

  const status = await resolveManualStatus(id, existing.status, input.status);

  return productRepository.update(id, {
    name: input.name,
    description: input.description,
    owner: input.ownerId ? { connect: { id: input.ownerId } } : undefined,
    status,
    expectedCompletionDate: input.expectedCompletionDate,
    actualCompletionDate: input.actualCompletionDate,
  });
}

export async function deleteProduct(actor: Actor, id: string) {
  const { access } = await requireAccess(actor, id);
  requireAuthority(access, "delete this product");
  await productRepository.remove(id);
}

export async function createProductVersion(
  actor: Actor,
  productId: string,
  input: CreateProductVersionInput,
) {
  const { product, access } = await requireAccess(actor, productId);
  requireAuthority(access, "add a version to this product");

  const createdById = input.createdById ?? product.ownerId;
  const creator = await userRepository.findById(createdById);
  if (!creator) {
    throw new ValidationError(`createdById ${createdById} does not reference an existing user`);
  }

  const nextVersionNumber = product.currentVersion + 1;

  return prisma.$transaction(async (tx) => {
    const version = await productVersionRepository.create(
      {
        product: { connect: { id: productId } },
        versionNumber: nextVersionNumber,
        spec: input.spec,
        createdBy: { connect: { id: createdById } },
      },
      tx,
    );

    const updatedProduct = await productRepository.update(
      productId,
      { currentVersion: nextVersionNumber },
      tx,
    );

    return { product: updatedProduct, version };
  });
}
