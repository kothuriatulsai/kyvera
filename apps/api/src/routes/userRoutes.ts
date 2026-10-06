import { Router } from "express";
import * as userController from "../controllers/userController";
import { requireRole } from "../middleware/requireRole";
import { uuidParam } from "../middleware/uuidParam";

// Admin-only user management (ADR 0010/0011). Unlike the other SOP routers,
// every route here - reads included - is gated: there's no "any authenticated
// user may read" case for the user list.
export const userRoutes = Router();

userRoutes.param("id", uuidParam);
userRoutes.use(requireRole("ADMIN"));

userRoutes.get("/", userController.listUsers);
userRoutes.post("/", userController.createUser);
userRoutes.patch("/:id/role", userController.changeRole);
userRoutes.post("/:id/deactivate", userController.deactivateUser);
userRoutes.post("/:id/reactivate", userController.reactivateUser);
userRoutes.post("/:id/reset-password", userController.resetPassword);
