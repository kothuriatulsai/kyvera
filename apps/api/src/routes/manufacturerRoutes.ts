import { Router } from "express";
import * as manufacturerController from "../controllers/manufacturerController";
import { requireRole } from "../middleware/requireRole";
import { uuidParam } from "../middleware/uuidParam";

// Manufacturer master data (ADR 0006 point 7, ADR 0015). PMO/ADMIN only,
// reads included - narrow operational master data for the assign-manufacturer
// picker, not general reference data (the assigned manufacturer's own
// details travel on the ProtoRequest response for everyone who can see it).
export const manufacturerRoutes = Router();

manufacturerRoutes.param("id", uuidParam);
manufacturerRoutes.use(requireRole("PMO", "ADMIN"));

manufacturerRoutes.get("/", manufacturerController.listManufacturers);
manufacturerRoutes.post("/", manufacturerController.createManufacturer);
manufacturerRoutes.patch("/:id", manufacturerController.updateManufacturer);
manufacturerRoutes.post("/:id/deactivate", manufacturerController.deactivateManufacturer);
manufacturerRoutes.post("/:id/reactivate", manufacturerController.reactivateManufacturer);
