import path from "node:path";
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: path.join("src", "prisma", "schema.prisma"),
  migrations: {
    path: path.join("src", "prisma", "migrations"),
    seed: "tsx src/prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
