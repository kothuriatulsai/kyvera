import type { Request, Response } from "express";
import { requireActor } from "../middleware/authenticate";
import * as notificationService from "../services/notificationService";
import * as taskService from "../services/taskService";
import { asyncHandler } from "./asyncHandler";

export const getMyTasks = asyncHandler(async (req: Request, res: Response) => {
  res.json(await taskService.listMyTasks(requireActor(req)));
});

export const listMyNotifications = asyncHandler(async (req: Request, res: Response) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const limitParam = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const limit = limitParam !== undefined && Number.isInteger(limitParam) && limitParam > 0 ? limitParam : undefined;
  res.json(await notificationService.listForRecipient(requireActor(req), cursor, limit));
});

export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  res.json({ count: await notificationService.countUnread(requireActor(req)) });
});

export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.markRead(requireActor(req), req.params.id);
  res.status(204).send();
});

export const markAllNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.markAllRead(requireActor(req));
  res.status(204).send();
});
