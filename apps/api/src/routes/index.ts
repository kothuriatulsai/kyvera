import { Router } from "express";
import { productRoutes } from "./productRoutes";
import { stageRoutes } from "./stageRoutes";

export const routes = Router();

routes.use("/products", productRoutes);
routes.use("/stages", stageRoutes);
