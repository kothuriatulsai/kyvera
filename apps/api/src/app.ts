import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { getAllowedOrigins } from "./config";
import { routes } from "./routes";
import { AppError } from "./services/errors";

export function createApp(): Express {
  const app = express();

  // An explicit allowlist, not the wildcard default: the API takes bearer tokens.
  // An origin that isn't on it gets no CORS response headers of any kind (the CORS
  // layer is skipped entirely), so a browser refuses to hand the response to the
  // calling page. Requests with no Origin header (curl, server-to-server) are not
  // browsers and are unaffected.
  const allowedOrigins = getAllowedOrigins();
  const corsForAllowedOrigins = cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600, // let browsers cache the preflight for 10 minutes
  });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      next();
      return;
    }
    corsForAllowedOrigins(req, res, next);
  });
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(routes);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires 4-arg error middleware
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      if (err.statusCode === 401) {
        res.set("WWW-Authenticate", "Bearer");
      }
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
