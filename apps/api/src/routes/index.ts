import { Router } from "express";
import { productRoutes } from "./productRoutes";

export const routes = Router();

routes.use("/products", productRoutes);
