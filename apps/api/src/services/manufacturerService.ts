import { Prisma } from "@prisma/client";
import * as manufacturerRepository from "../repositories/manufacturerRepository";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

/**
 * ADR 0015: Manufacturer master data (ADR 0006 point 7) - not a `users` row,
 * no `code` (the SOP's own §12 traceability table doesn't name one for it).
 * PMO/ADMIN-only, enforced by the route, not here - this module has no
 * visibility-module involvement at all, since it isn't Project-scoped.
 */

export interface CreateManufacturerInput {
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export type UpdateManufacturerInput = Partial<CreateManufacturerInput>;

function normalizeInput<T extends CreateManufacturerInput | UpdateManufacturerInput>(input: T): T {
  if ("name" in input && input.name !== undefined && input.name.trim() === "") {
    throw new ValidationError("name must be a non-empty string");
  }
  return input;
}

export async function createManufacturer(createdById: string, input: CreateManufacturerInput) {
  normalizeInput(input);
  return manufacturerRepository.create({
    name: input.name.trim(),
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    createdBy: { connect: { id: createdById } },
  });
}

export function listManufacturers(includeInactive = false) {
  return manufacturerRepository.findMany(includeInactive ? {} : { isActive: true });
}

async function requireManufacturer(id: string) {
  const manufacturer = await manufacturerRepository.findById(id);
  if (!manufacturer) {
    throw new NotFoundError(`Manufacturer ${id} not found`);
  }
  return manufacturer;
}

export async function updateManufacturer(id: string, input: UpdateManufacturerInput) {
  normalizeInput(input);
  await requireManufacturer(id);
  try {
    return await manufacturerRepository.update(id, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
      ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
      ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new NotFoundError(`Manufacturer ${id} not found`);
    }
    throw err;
  }
}

export async function deactivateManufacturer(id: string) {
  await requireManufacturer(id);
  return manufacturerRepository.setActive(id, false);
}

export async function reactivateManufacturer(id: string) {
  await requireManufacturer(id);
  return manufacturerRepository.setActive(id, true);
}

// Used by protoRequestService.assignManufacturer - a deactivated
// Manufacturer can't be newly assigned, same reasoning as a deactivated
// User being unaddable to a Project (ADR 0013).
export async function requireActiveManufacturer(id: string) {
  const manufacturer = await requireManufacturer(id);
  if (!manufacturer.isActive) {
    throw new ConflictError(`Manufacturer ${manufacturer.name} is deactivated`);
  }
  return manufacturer;
}
