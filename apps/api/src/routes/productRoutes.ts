import { Router } from "express";
import * as productController from "../controllers/productController";

export const productRoutes = Router();

productRoutes.get("/", productController.listProducts);
productRoutes.post("/", productController.createProduct);
productRoutes.get("/:id", productController.getProduct);
productRoutes.patch("/:id", productController.updateProduct);
productRoutes.delete("/:id", productController.deleteProduct);
productRoutes.post("/:id/versions", productController.createProductVersion);
productRoutes.post("/:id/transition", productController.transitionProduct);
