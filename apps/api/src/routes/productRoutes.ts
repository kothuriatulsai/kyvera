import { Router } from "express";
import * as assignmentController from "../controllers/assignmentController";
import * as productController from "../controllers/productController";
import { uuidParam } from "../middleware/uuidParam";

export const productRoutes = Router();

// A malformed id can't match anything: 404 rather than a database error.
productRoutes.param("id", uuidParam);
productRoutes.param("assignmentId", uuidParam);
productRoutes.param("stageId", uuidParam);

productRoutes.get("/", productController.listProducts);
productRoutes.post("/", productController.createProduct);
productRoutes.get("/:id", productController.getProduct);
productRoutes.get("/:id/delay", productController.getProductDelay);
productRoutes.patch("/:id", productController.updateProduct);
productRoutes.delete("/:id", productController.deleteProduct);
productRoutes.post("/:id/versions", productController.createProductVersion);
productRoutes.post("/:id/transition", productController.transitionProduct);

// Stage assignments: managed by admins; an assignee marks their own ready.
productRoutes.post("/:id/assignments", assignmentController.assignUser);
productRoutes.delete("/:id/assignments/:assignmentId", assignmentController.unassignUser);
productRoutes.post("/:id/assignments/:assignmentId/ready", assignmentController.markReady);

// Progress notes, by assignees on their own stage.
productRoutes.post("/:id/stages/:stageId/notes", assignmentController.addProgressNote);
