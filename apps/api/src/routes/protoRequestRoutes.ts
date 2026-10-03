import { Router } from "express";
import * as protoRequestController from "../controllers/protoRequestController";
import { uuidParam } from "../middleware/uuidParam";

// SOP domain, Stage 3's output / Stage 4's subject (ADR 0006 point 8). Reads
// only, for now - a ProtoRequest is created only as a side effect of
// approving a TechPack version (techPackDecisionService.decideTechPackVersion),
// no direct write endpoint exists.
export const protoRequestRoutes = Router();

protoRequestRoutes.param("id", uuidParam);

protoRequestRoutes.get("/", protoRequestController.listProtoRequests);
protoRequestRoutes.get("/:id", protoRequestController.getProtoRequest);
