import type { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  determineAccess,
  fullAccessProductsWhere,
  visibleProductsWhere,
} from "../src/services/accessService";

const OWNER_ID = "owner-id";
const actor = (id: string, role: UserRole) => ({ id, role });

// The whole access decision, as a table. `null` means the product does not
// exist for that actor.
describe("determineAccess", () => {
  it.each([
    // [description, actor, ownerId, actor's assigned stages, expected level, full?]
    ["an admin with no tie to the product", actor("a", "ADMIN"), OWNER_ID, [], "ADMIN", true],
    ["an admin who is also assigned", actor("a", "ADMIN"), OWNER_ID, ["s1"], "ADMIN", true],
    ["the owner, whatever their role", actor(OWNER_ID, "ENGINEER"), OWNER_ID, [], "OWNER", true],
    ["the owner who is also assigned", actor(OWNER_ID, "FINANCE"), OWNER_ID, ["s1"], "OWNER", true],
    ["a manager assigned to a stage", actor("m", "MANAGER"), OWNER_ID, ["s2"], "MANAGER", true],
    ["an engineer assigned to a stage", actor("e", "ENGINEER"), OWNER_ID, ["s2"], "ASSIGNEE", false],
    ["a finance user assigned to a stage", actor("f", "FINANCE"), OWNER_ID, ["s2", "s3"], "ASSIGNEE", false],
  ] as const)("gives %s the right access", (_label, who, ownerId, assigned, level, full) => {
    expect(determineAccess(who, ownerId, [...assigned])).toEqual({
      level,
      full,
      assignedStageIds: [...assigned],
    });
  });

  it.each([
    ["a manager with no assignment (role alone grants nothing)", actor("m", "MANAGER")],
    ["an engineer with no assignment", actor("e", "ENGINEER")],
    ["a finance user with no assignment", actor("f", "FINANCE")],
  ])("gives %s no access at all", (_label, who) => {
    expect(determineAccess(who, OWNER_ID, [])).toBeNull();
  });

  it("never treats an assignee as having authority", () => {
    expect(determineAccess(actor("e", "ENGINEER"), OWNER_ID, ["s1", "s2", "s3"])?.full).toBe(false);
  });
});

describe("the list queries encode the same rule", () => {
  it("an admin's filters are unscoped", () => {
    expect(visibleProductsWhere(actor("a", "ADMIN"))).toEqual({});
    expect(fullAccessProductsWhere(actor("a", "ADMIN"))).toEqual({});
  });

  it("everyone else sees products they own or are assigned to, and nothing else", () => {
    expect(visibleProductsWhere(actor("u", "ENGINEER"))).toEqual({
      OR: [{ ownerId: "u" }, { assignments: { some: { userId: "u" } } }],
    });
  });

  it("only owners and assigned managers see products in full", () => {
    expect(fullAccessProductsWhere(actor("u", "ENGINEER"))).toEqual({ ownerId: "u" });
    expect(fullAccessProductsWhere(actor("m", "MANAGER"))).toEqual({
      OR: [{ ownerId: "m" }, { assignments: { some: { userId: "m" } } }],
    });
  });
});
