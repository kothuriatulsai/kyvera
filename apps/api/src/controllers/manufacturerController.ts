import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as manufacturerService from "../services/manufacturerService";
import { asyncHandler } from "./asyncHandler";
import { optionalString, requireString } from "./requestParsing";

function createInputFrom(body: Record<string, unknown>) {
  return {
    name: requireString(body, "name"),
    contactName: optionalString(body, "contactName"),
    contactEmail: optionalString(body, "contactEmail"),
    contactPhone: optionalString(body, "contactPhone"),
  };
}

function updateInputFrom(body: Record<string, unknown>) {
  return {
    name: body.name === undefined ? undefined : requireString(body, "name"),
    contactName: optionalString(body, "contactName"),
    contactEmail: optionalString(body, "contactEmail"),
    contactPhone: optionalString(body, "contactPhone"),
  };
}

export const listManufacturers = asyncHandler(async (req: Request, res: Response) => {
  const includeInactive = req.query.includeInactive === "true";
  res.json(await manufacturerService.listManufacturers(includeInactive));
});

export const createManufacturer = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const manufacturer = await manufacturerService.createManufacturer(
    actor.id,
    createInputFrom(req.body as Record<string, unknown>),
  );
  res.status(201).json(manufacturer);
});

export const updateManufacturer = asyncHandler(async (req: Request, res: Response) => {
  const manufacturer = await manufacturerService.updateManufacturer(
    req.params.id,
    updateInputFrom(req.body as Record<string, unknown>),
  );
  res.json(manufacturer);
});

export const deactivateManufacturer = asyncHandler(async (req: Request, res: Response) => {
  res.json(await manufacturerService.deactivateManufacturer(req.params.id));
});

export const reactivateManufacturer = asyncHandler(async (req: Request, res: Response) => {
  res.json(await manufacturerService.reactivateManufacturer(req.params.id));
});
