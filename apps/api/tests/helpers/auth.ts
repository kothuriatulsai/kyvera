import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { signAccessToken } from "../../src/services/tokenService";

/**
 * A supertest agent that sends a valid bearer token on every request, for the
 * suites that exercise protected routes.
 *
 * The token is minted directly rather than through /auth/login, and its user
 * id is a random UUID with no row behind it: `authenticate` only verifies the
 * token and nothing authorizes on identity yet. Once ADR 0004's enforcement
 * lands, these suites should mint tokens for real users (with the right role /
 * ownership / assignments) instead.
 */
export function authedAgent(app: Express, role: UserRole = "ADMIN") {
  const { token } = signAccessToken({ id: randomUUID(), role });
  return request.agent(app).set("Authorization", `Bearer ${token}`);
}
