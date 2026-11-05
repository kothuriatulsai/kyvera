import { Router } from "express";
import * as meController from "../controllers/meController";
import { uuidParam } from "../middleware/uuidParam";

// ADR 0014: "My tasks" + notifications, both scoped to req.actor - no
// requireRole gate, every role may call these for themselves.
export const meRoutes = Router();

meRoutes.param("id", uuidParam);

meRoutes.get("/tasks", meController.getMyTasks);

meRoutes.get("/notifications", meController.listMyNotifications);
meRoutes.get("/notifications/unread-count", meController.getUnreadCount);
meRoutes.post("/notifications/:id/read", meController.markNotificationRead);
meRoutes.post("/notifications/read-all", meController.markAllNotificationsRead);
