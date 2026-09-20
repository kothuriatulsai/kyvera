import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { cleanupTestUsers, createTestUser, type TestUser } from "./helpers/auth";

/**
 * ADR 0004 end to end: who is this caller *to this product*, and what does that
 * let them see and do? Every scenario runs against the real HTTP API with real
 * users, because the interesting failures are in the wiring, not the pieces.
 */
const app = createApp();

let admin: TestUser;
let owner: TestUser; // owns the products; deliberately only an ENGINEER
let otherOwner: TestUser; // owns a product none of our other users have any tie to
let assignedManager: TestUser;
let unrelatedManager: TestUser;
let designer: TestUser; // sole assignee of stage 2
let reviewer: TestUser; // sole assignee of stage 4
let multi1: TestUser; // co-assignee (with multi2) of stage 5
let multi2: TestUser;
let stranger: TestUser;

interface Stage {
  id: string;
  name: string;
  sequenceOrder: number;
  expectedDurationDays: number;
}
let stages: Stage[];
const stage = (order: number) => stages.find((s) => s.sequenceOrder === order) as Stage;

const createdProductIds: string[] = [];

async function createProduct(ownerId = owner.id, name = "Access Widget") {
  const res = await admin.agent.post("/products").send({ name, ownerId, description: "a widget" });
  expect(res.status).toBe(201);
  createdProductIds.push(res.body.id);
  return res.body.id as string;
}

async function advanceTo(productId: string, order: number) {
  for (let current = (await currentOrder(productId)) ; current < order; current++) {
    const res = await admin.agent.post(`/products/${productId}/transition`).send({ force: true });
    expect(res.status).toBe(200);
  }
}

async function currentOrder(productId: string) {
  const res = await admin.agent.get(`/products/${productId}`);
  return res.body.currentStage.sequenceOrder as number;
}

async function assign(productId: string, order: number, user: TestUser) {
  const res = await admin.agent
    .post(`/products/${productId}/assignments`)
    .send({ stageId: stage(order).id, userId: user.id });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Every stage name appearing as a JSON string value anywhere in a response. */
function stageNamesIn(body: unknown): string[] {
  const json = JSON.stringify(body);
  return stages.map((s) => s.name).filter((name) => json.includes(`"${name}"`));
}

beforeAll(async () => {
  stages = (await prisma.stageDefinition.findMany({ orderBy: { sequenceOrder: "asc" } })) as Stage[];
  if (stages.length < 6) {
    throw new Error(
      "stage_definitions is empty or too short — run `npm run db:seed --workspace apps/api` before testing",
    );
  }

  admin = await createTestUser(app, "ADMIN");
  owner = await createTestUser(app, "ENGINEER", "owner");
  otherOwner = await createTestUser(app, "ENGINEER", "other-owner");
  assignedManager = await createTestUser(app, "MANAGER", "assigned-manager");
  unrelatedManager = await createTestUser(app, "MANAGER", "unrelated-manager");
  designer = await createTestUser(app, "ENGINEER", "designer");
  reviewer = await createTestUser(app, "ENGINEER", "reviewer");
  multi1 = await createTestUser(app, "ENGINEER", "multi1");
  multi2 = await createTestUser(app, "FINANCE", "multi2");
  stranger = await createTestUser(app, "ENGINEER", "stranger");
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await cleanupTestUsers();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("An assignee sees only their own stages", () => {
  let productId: string;
  let otherProductId: string;

  beforeAll(async () => {
    productId = await createProduct();
    otherProductId = await createProduct(otherOwner.id, "Somebody Else's Widget");
    await assign(productId, 2, designer);
    await assign(productId, 4, reviewer);
    await assign(productId, 3, assignedManager);
  });

  it("lists only products they are assigned to, each reduced to their own stages", async () => {
    const res = await designer.agent.get("/products");

    expect(res.status).toBe(200);
    expect(res.body.map((p: { id: string }) => p.id)).toEqual([productId]);
    expect(res.body[0]).toMatchObject({
      view: "assignee",
      access: "ASSIGNEE",
      id: productId,
      name: "Access Widget",
    });
    expect(res.body[0].stages).toHaveLength(1);
    expect(res.body[0].stages[0].stage.name).toBe(stage(2).name);
  });

  it("exposes no other stage's name, and none of the product's wider details", async () => {
    const list = await designer.agent.get("/products");
    const detail = await designer.agent.get(`/products/${productId}`);
    const delay = await designer.agent.get(`/products/${productId}/delay`);

    for (const body of [list.body, detail.body, delay.body]) {
      expect(stageNamesIn(body)).toEqual([stage(2).name]);
    }

    const product = detail.body;
    for (const hidden of [
      "owner",
      "ownerId",
      "status",
      "delay",
      "currentStage",
      "currentVersion",
      "startDate",
      "expectedCompletionDate",
      "versions",
      "stageHistory",
      "approvals",
      "assignments",
      "progressNotes",
    ]) {
      expect(product, `assignee detail must not expose "${hidden}"`).not.toHaveProperty(hidden);
    }
    // ...and nothing that says where in the workflow their stage sits.
    expect(product.stages[0].stage).not.toHaveProperty("sequenceOrder");
    // No other user's identity leaks either.
    expect(JSON.stringify(product)).not.toContain(owner.email);
    expect(JSON.stringify(product)).not.toContain(reviewer.id);
  });

  it("gives them a readiness hint computed from the whole workflow", async () => {
    // The product is at stage 1, so stage 2 is next and stage 4 is further out.
    const designerView = await designer.agent.get(`/products/${productId}`);
    const reviewerView = await reviewer.agent.get(`/products/${productId}`);

    expect(designerView.body.stages[0].readiness).toEqual({
      state: "up_next",
      opensInDays: stage(1).expectedDurationDays,
    });
    // Stage 4 waits on the rest of stage 1 plus all of stages 2 and 3 - stages
    // the reviewer cannot see, but whose durations the answer must include.
    expect(reviewerView.body.stages[0].readiness).toEqual({
      state: "upcoming",
      opensInDays:
        stage(1).expectedDurationDays + stage(2).expectedDurationDays + stage(3).expectedDurationDays,
    });
  });

  it("updates the hint as the product moves: open now, then completed", async () => {
    await advanceTo(productId, 2);
    let view = await designer.agent.get(`/products/${productId}`);
    expect(view.body.stages[0].readiness).toEqual({ state: "open_now", opensInDays: null });

    await advanceTo(productId, 3);
    view = await designer.agent.get(`/products/${productId}`);
    expect(view.body.stages[0].readiness).toEqual({ state: "completed", opensInDays: null });
    // Their own stage's history is visible to them now; nobody else's is.
    expect(view.body.stages[0].history).toHaveLength(1);
    expect(view.body.stages[0].history[0]).not.toHaveProperty("responsibleUser");

    view = await reviewer.agent.get(`/products/${productId}`);
    expect(view.body.stages[0].readiness.state).toBe("up_next");
    expect(view.body.stages[0].history).toEqual([]);
  });

  it("only lists the stage definitions they are assigned to", async () => {
    const res = await designer.agent.get("/stages");

    expect(res.status).toBe(200);
    expect(res.body.map((s: { name: string }) => s.name)).toEqual([stage(2).name]);
  });

  it("does not see a product they are not assigned to, even one they could guess the id of", async () => {
    expect((await designer.agent.get(`/products/${otherProductId}`)).status).toBe(404);
    expect((await designer.agent.get(`/products/${otherProductId}/delay`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe("Someone with no ownership and no assignment gets nothing", () => {
  let productId: string;

  beforeAll(async () => {
    productId = await createProduct();
    await assign(productId, 2, designer);
  });

  it.each([
    ["a plain user", () => stranger],
    ["a manager (the role alone grants nothing)", () => unrelatedManager],
  ])("%s does not see the product in the list at all", async (_who, actor) => {
    const res = await actor().agent.get("/products");

    expect(res.status).toBe(200);
    expect(res.body.map((p: { id: string }) => p.id)).not.toContain(productId);
  });

  it.each([
    ["a plain user", () => stranger],
    ["a manager", () => unrelatedManager],
  ])("%s gets a 404 on every read and write, as if it didn't exist", async (_who, actor) => {
    const { agent } = actor();
    const id = productId;

    const attempts = [
      await agent.get(`/products/${id}`),
      await agent.get(`/products/${id}/delay`),
      await agent.patch(`/products/${id}`).send({ name: "hijacked" }),
      await agent.delete(`/products/${id}`),
      await agent.post(`/products/${id}/versions`).send({ spec: "x" }),
      await agent.post(`/products/${id}/transition`).send({}),
      await agent.post(`/products/${id}/stages/${stage(2).id}/notes`).send({ note: "hi" }),
    ];
    for (const res of attempts) expect(res.status).toBe(404);

    // ...and the same message as a product that really doesn't exist.
    const missing = await agent.get("/products/00000000-0000-0000-0000-000000000000");
    expect(attempts[0].body).toEqual({ error: `Product ${id} not found` });
    expect(missing.body).toEqual({ error: "Product 00000000-0000-0000-0000-000000000000 not found" });

    const still = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(still.name).toBe("Access Widget");
  });

  it("sees no stage definitions at all", async () => {
    const res = await stranger.agent.get("/stages");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("treats a malformed id as not found rather than a server error", async () => {
    expect((await admin.agent.get("/products/not-a-uuid")).status).toBe(404);
    expect((await admin.agent.post("/products/not-a-uuid/transition").send({})).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe("The owner sees their own product in full - and only their own", () => {
  let mine: string;
  let notMine: string;

  beforeAll(async () => {
    mine = await createProduct(owner.id, "Owner's Widget");
    notMine = await createProduct(otherOwner.id, "Not The Owner's Widget");
    await assign(mine, 2, designer);
    await assign(mine, 4, reviewer);
  });

  it("returns the whole product, whatever the owner's role and without any assignment", async () => {
    const res = await owner.agent.get(`/products/${mine}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ view: "full", access: "OWNER", id: mine });
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.stageHistory).toHaveLength(1);
    expect(res.body.assignments).toHaveLength(2);
    expect(res.body.owner.id).toBe(owner.id);
  });

  it("lists it, live status included, and not the product they don't own", async () => {
    const res = await owner.agent.get("/products");
    const ids = res.body.map((p: { id: string }) => p.id);

    expect(ids).toContain(mine);
    expect(ids).not.toContain(notMine);
    const entry = res.body.find((p: { id: string }) => p.id === mine);
    expect(entry).toMatchObject({ view: "full", access: "OWNER", status: "ON_TRACK" });
  });

  it("gets a 404 for a product they don't own", async () => {
    expect((await owner.agent.get(`/products/${notMine}`)).status).toBe(404);
    expect((await owner.agent.get(`/products/${notMine}/delay`)).status).toBe(404);
  });

  it("sees every stage definition", async () => {
    const res = await owner.agent.get("/stages");
    expect(res.body).toHaveLength(stages.length);
  });

  it("returns the full delay breakdown", async () => {
    const res = await owner.agent.get(`/products/${mine}/delay`);
    expect(res.body).toMatchObject({ view: "full", delayed: false });
    expect(res.body.stages).toHaveLength(stages.length);
  });

  it("is not a general grant: another product's owner sees theirs, not this one", async () => {
    const theirs = await otherOwner.agent.get("/products");
    const ids = theirs.body.map((p: { id: string }) => p.id);
    expect(ids).toContain(notMine);
    expect(ids).not.toContain(mine);
  });
});

describe("A manager only has reach over products they are assigned to", () => {
  let tied: string;
  let untied: string;

  beforeAll(async () => {
    tied = await createProduct(owner.id, "Managed Widget");
    untied = await createProduct(owner.id, "Unmanaged Widget");
    await assign(tied, 3, assignedManager);
    await advanceTo(tied, 4);
  });

  it("sees the whole of a product they are assigned to, not just their stage", async () => {
    const res = await assignedManager.agent.get(`/products/${tied}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ view: "full", access: "MANAGER" });
    expect(stageNamesIn(res.body.stageHistory)).toContain(stage(1).name);
  });

  it("can move it backward, and force it forward", async () => {
    const back = await assignedManager.agent
      .post(`/products/${tied}/transition`)
      .send({ direction: "backward", reason: "rework needed" });
    expect(back.status).toBe(200);
    expect(back.body.currentStage.sequenceOrder).toBe(3);

    const forward = await assignedManager.agent.post(`/products/${tied}/transition`).send({});
    expect(forward.status).toBe(200);
  });

  it("cannot see or act on a product they have no tie to", async () => {
    expect((await assignedManager.agent.get(`/products/${untied}`)).status).toBe(404);
    const move = await assignedManager.agent
      .post(`/products/${untied}/transition`)
      .send({ direction: "backward", reason: "nope" });
    expect(move.status).toBe(404);
    expect(await currentOrder(untied)).toBe(1);

    const listed = await assignedManager.agent.get("/products");
    expect(listed.body.map((p: { id: string }) => p.id)).not.toContain(untied);
  });

  it("an unrelated manager can do none of it", async () => {
    const move = await unrelatedManager.agent
      .post(`/products/${tied}/transition`)
      .send({ direction: "backward", reason: "nope" });
    expect(move.status).toBe(404);
  });

  it("gets every stage definition once they see a product in full", async () => {
    expect((await assignedManager.agent.get("/stages")).body).toHaveLength(stages.length);
    expect((await unrelatedManager.agent.get("/stages")).body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("An assignee cannot use authority they don't hold", () => {
  let productId: string;

  beforeAll(async () => {
    productId = await createProduct();
    await assign(productId, 2, designer);
    await advanceTo(productId, 3);
  });

  it("cannot move the product backward", async () => {
    const res = await designer.agent
      .post(`/products/${productId}/transition`)
      .send({ direction: "backward", reason: "changed my mind" });
    expect(res.status).toBe(403);
    expect(await currentOrder(productId)).toBe(3);
  });

  it("cannot force a transition", async () => {
    const res = await designer.agent.post(`/products/${productId}/transition`).send({ force: true });
    expect(res.status).toBe(403);
    expect(await currentOrder(productId)).toBe(3);
  });

  it("cannot advance a stage that isn't theirs", async () => {
    // The product is in stage 3; the designer's stage is 2.
    const res = await designer.agent.post(`/products/${productId}/transition`).send({});
    expect(res.status).toBe(403);
    expect(await currentOrder(productId)).toBe(3);
  });

  it("cannot edit, delete or version the product", async () => {
    expect((await designer.agent.patch(`/products/${productId}`).send({ name: "x" })).status).toBe(403);
    expect((await designer.agent.delete(`/products/${productId}`)).status).toBe(403);
    expect((await designer.agent.post(`/products/${productId}/versions`).send({ spec: "x" })).status).toBe(403);
    expect(await prisma.product.count({ where: { id: productId } })).toBe(1);
  });

  it("cannot manage assignments - that is an admin action", async () => {
    const res = await designer.agent
      .post(`/products/${productId}/assignments`)
      .send({ stageId: stage(5).id, userId: designer.id });
    expect(res.status).toBe(403);
  });

  it("cannot approve (covered in the approval suite too)", async () => {
    const approving = await createProduct();
    await assign(approving, 8, designer);
    await advanceTo(approving, 8);

    const res = await designer.agent
      .post(`/products/${approving}/transition`)
      .send({ approval: { decision: "APPROVED" } });
    expect(res.status).toBe(403);
    expect(await prisma.approval.count({ where: { productId: approving } })).toBe(0);
  });
});

describe("Only some people can change a product's details", () => {
  it("lets the owner edit their product but not hand it to someone else", async () => {
    const productId = await createProduct();

    const rename = await owner.agent.patch(`/products/${productId}`).send({ name: "Renamed by owner" });
    expect(rename.status).toBe(200);
    expect(rename.body.name).toBe("Renamed by owner");

    const handOver = await owner.agent.patch(`/products/${productId}`).send({ ownerId: stranger.id });
    expect(handOver.status).toBe(403);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).ownerId).toBe(owner.id);
  });

  it("lets an admin change the owner", async () => {
    const productId = await createProduct();

    const res = await admin.agent.patch(`/products/${productId}`).send({ ownerId: otherOwner.id });
    expect(res.status).toBe(200);
    expect((await otherOwner.agent.get(`/products/${productId}`)).status).toBe(200);
    expect((await owner.agent.get(`/products/${productId}`)).status).toBe(404);
  });

  it("does not let a creator see a product they created for someone else", async () => {
    const res = await stranger.agent
      .post("/products")
      .send({ name: "Made For Somebody Else", ownerId: owner.id });
    expect(res.status).toBe(201);
    createdProductIds.push(res.body.id);

    // Only the id and name they supplied - not the product, and so not the
    // owner's details.
    expect(Object.keys(res.body).sort()).toEqual(["id", "name"]);
    expect((await stranger.agent.get(`/products/${res.body.id}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe("Several assignees on one stage", () => {
  let productId: string;
  let a1: string; // multi1's assignment
  let a2: string; // multi2's assignment

  beforeAll(async () => {
    productId = await createProduct();
    a1 = await assign(productId, 5, multi1);
    a2 = await assign(productId, 5, multi2);
    await advanceTo(productId, 5);
  });

  it("lets each mark themselves ready, and only themselves", async () => {
    // Not a colleague's...
    const theirs = await multi1.agent.post(`/products/${productId}/assignments/${a2}/ready`);
    expect(theirs.status).toBe(403);
    // ...and not even an admin's (an admin who wants to move on forces it instead).
    const byAdmin = await admin.agent.post(`/products/${productId}/assignments/${a1}/ready`);
    expect(byAdmin.status).toBe(403);
    expect((await prisma.productStageAssignment.findUniqueOrThrow({ where: { id: a2 } })).readyAt).toBeNull();

    const own = await multi1.agent.post(`/products/${productId}/assignments/${a1}/ready`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ assignmentId: a1, stageId: stage(5).id });
    const firstMark = own.body.readyAt;

    // Idempotent: marking again keeps the original time.
    const again = await multi1.agent.post(`/products/${productId}/assignments/${a1}/ready`);
    expect(again.body.readyAt).toBe(firstMark);
  });

  it("does not advance until everyone is ready, unless someone with authority forces it", async () => {
    // multi1 is ready, multi2 is not.
    const byAssignee = await multi1.agent.post(`/products/${productId}/transition`).send({});
    expect(byAssignee.status).toBe(403);

    const byAdmin = await admin.agent.post(`/products/${productId}/transition`).send({});
    expect(byAdmin.status).toBe(409);
    expect(byAdmin.body.error).toMatch(/1 of 2 assignees have not marked this stage ready/);
    expect(await currentOrder(productId)).toBe(5);
  });

  it("does not fire on the last sign-off either: it still needs a manual trigger", async () => {
    const last = await multi2.agent.post(`/products/${productId}/assignments/${a2}/ready`);
    expect(last.status).toBe(200);

    // Everyone is ready, and nothing moved.
    expect(await currentOrder(productId)).toBe(5);

    // Neither assignee - including the one who signed off last - can trigger it.
    expect((await multi2.agent.post(`/products/${productId}/transition`).send({})).status).toBe(403);
    expect((await multi1.agent.post(`/products/${productId}/transition`).send({})).status).toBe(403);
    expect(await currentOrder(productId)).toBe(5);
  });

  it("is triggered by the owner, attributed to them, and isn't recorded as forced", async () => {
    const res = await owner.agent.post(`/products/${productId}/transition`).send({});

    expect(res.status).toBe(200);
    expect(res.body.currentStage.sequenceOrder).toBe(6);
    const left = await prisma.productStageHistory.findFirstOrThrow({
      where: { productId, stageId: stage(5).id },
    });
    expect(left.exitedById).toBe(owner.id);
    expect(left.forcedExit).toBe(false);
  });

  it("starts a fresh sign-off when the stage is entered again", async () => {
    const back = await admin.agent
      .post(`/products/${productId}/transition`)
      .send({ direction: "backward", reason: "rework" });
    expect(back.status).toBe(200);

    const marks = await prisma.productStageAssignment.findMany({ where: { productId, stageId: stage(5).id } });
    expect(marks).toHaveLength(2);
    expect(marks.every((m) => m.readyAt === null)).toBe(true);
  });

  it("can be forced without every sign-off, by authority only, and the bypass is recorded", async () => {
    const forcedProduct = await createProduct();
    const f1 = await assign(forcedProduct, 5, multi1);
    await assign(forcedProduct, 5, multi2);
    await advanceTo(forcedProduct, 5);
    await multi1.agent.post(`/products/${forcedProduct}/assignments/${f1}/ready`);

    const byAssignee = await multi1.agent.post(`/products/${forcedProduct}/transition`).send({ force: true });
    expect(byAssignee.status).toBe(403);

    const forced = await admin.agent.post(`/products/${forcedProduct}/transition`).send({ force: true });
    expect(forced.status).toBe(200);
    const left = await prisma.productStageHistory.findFirstOrThrow({
      where: { productId: forcedProduct, stageId: stage(5).id },
    });
    expect(left).toMatchObject({ exitedById: admin.id, forcedExit: true });
  });

  it("only accepts a ready mark on the product's current stage", async () => {
    const later = await createProduct();
    const inWrongStage = await assign(later, 5, multi1);
    // Still at stage 1.
    const res = await multi1.agent.post(`/products/${later}/assignments/${inWrongStage}/ready`);
    expect(res.status).toBe(409);
  });

  it("does not let a mark be set through another product's id, or by an outsider", async () => {
    const other = await createProduct();
    expect((await multi1.agent.post(`/products/${other}/assignments/${a1}/ready`)).status).toBe(404);
    expect((await stranger.agent.post(`/products/${productId}/assignments/${a1}/ready`)).status).toBe(404);
  });
});

describe("A sole assignee can advance their own stage directly", () => {
  it("moves the product on, is credited with it, and gets a projected response back", async () => {
    const productId = await createProduct();
    await assign(productId, 2, designer);
    await advanceTo(productId, 2);

    const res = await designer.agent.post(`/products/${productId}/transition`).send({});

    expect(res.status).toBe(200);
    // What they get back is their own view, not the whole product.
    expect(res.body).toMatchObject({ view: "assignee", access: "ASSIGNEE" });
    expect(res.body.stages[0].readiness.state).toBe("completed");
    for (const hidden of ["owner", "versions", "approvals", "stageHistory", "currentStage"]) {
      expect(res.body).not.toHaveProperty(hidden);
    }

    expect(await currentOrder(productId)).toBe(3);
    const left = await prisma.productStageHistory.findFirstOrThrow({
      where: { productId, stageId: stage(2).id },
    });
    expect(left).toMatchObject({ exitedById: designer.id, forcedExit: false });
  });

  it("does not need a ready mark first", async () => {
    const productId = await createProduct();
    await assign(productId, 2, designer);
    await advanceTo(productId, 2);

    const assignment = await prisma.productStageAssignment.findFirstOrThrow({ where: { productId } });
    expect(assignment.readyAt).toBeNull();
    expect((await designer.agent.post(`/products/${productId}/transition`).send({})).status).toBe(200);
  });

  it("still can't go backward", async () => {
    const productId = await createProduct();
    await assign(productId, 2, designer);
    await advanceTo(productId, 2);

    const res = await designer.agent
      .post(`/products/${productId}/transition`)
      .send({ direction: "backward", reason: "oops" });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------

describe("Progress notes", () => {
  let productId: string;

  beforeAll(async () => {
    productId = await createProduct();
    await assign(productId, 2, designer);
    await assign(productId, 2, multi1);
    await assign(productId, 4, reviewer);
    // The product stays in stage 1, so neither stage 2 nor stage 4 is current.
  });

  it("lets an assignee add one on their own stage at any time, without moving the product", async () => {
    const res = await designer.agent
      .post(`/products/${productId}/stages/${stage(2).id}/notes`)
      .send({ note: "  waiting on the supplier for the housing  " });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ stageId: stage(2).id, note: "waiting on the supplier for the housing" });
    expect(await currentOrder(productId)).toBe(1);
    expect(await prisma.stageProgressNote.count({ where: { productId } })).toBe(1);
  });

  it("does not let someone add a note to a stage that isn't theirs", async () => {
    const byOtherAssignee = await reviewer.agent
      .post(`/products/${productId}/stages/${stage(2).id}/notes`)
      .send({ note: "not mine" });
    expect(byOtherAssignee.status).toBe(403);

    // Not even the owner or an admin: a note belongs to an assignee of the stage.
    const byOwner = await owner.agent
      .post(`/products/${productId}/stages/${stage(2).id}/notes`)
      .send({ note: "not mine" });
    expect(byOwner.status).toBe(403);

    const byStranger = await stranger.agent
      .post(`/products/${productId}/stages/${stage(2).id}/notes`)
      .send({ note: "not mine" });
    expect(byStranger.status).toBe(404);

    expect(await prisma.stageProgressNote.count({ where: { productId } })).toBe(1);
  });

  it("rejects an empty or oversized note", async () => {
    const path = `/products/${productId}/stages/${stage(2).id}/notes`;
    expect((await designer.agent.post(path).send({ note: "   " })).status).toBe(400);
    expect((await designer.agent.post(path).send({ note: "x".repeat(2001) })).status).toBe(400);
  });

  it("shows a note to the stage's assignees, without naming its author, and to nobody else's", async () => {
    const colleague = await multi1.agent.get(`/products/${productId}`);
    expect(colleague.body.stages[0].notes).toHaveLength(1);
    expect(colleague.body.stages[0].notes[0]).toMatchObject({ isMine: false });
    expect(colleague.body.stages[0].notes[0]).not.toHaveProperty("userId");
    expect(colleague.body.stages[0].notes[0]).not.toHaveProperty("user");

    const author = await designer.agent.get(`/products/${productId}`);
    expect(author.body.stages[0].notes[0]).toMatchObject({ isMine: true });

    // The reviewer is assigned to a different stage: no trace of it.
    const other = await reviewer.agent.get(`/products/${productId}`);
    expect(other.body.stages).toHaveLength(1);
    expect(other.body.stages[0].notes).toEqual([]);
    expect(JSON.stringify(other.body)).not.toContain("housing");
  });

  it("shows every note, with its author, to the owner", async () => {
    const res = await owner.agent.get(`/products/${productId}`);
    expect(res.body.progressNotes).toHaveLength(1);
    expect(res.body.progressNotes[0]).toMatchObject({
      note: "waiting on the supplier for the housing",
      user: { id: designer.id },
    });
  });
});

// ---------------------------------------------------------------------------

describe("Managing assignments is an admin action, and is audited", () => {
  let productId: string;

  beforeAll(async () => {
    productId = await createProduct();
  });

  it("records who assigned whom, and to what, in the history table", async () => {
    const assignmentId = await assign(productId, 2, designer);

    const history = await prisma.productStageAssignmentHistory.findMany({ where: { productId } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      stageId: stage(2).id,
      userId: designer.id,
      action: "ASSIGNED",
      actedById: admin.id,
    });

    const row = await prisma.productStageAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(row.assignedById).toBe(admin.id);
  });

  it("rejects a duplicate, an unknown stage and an unknown user", async () => {
    const dup = await admin.agent
      .post(`/products/${productId}/assignments`)
      .send({ stageId: stage(2).id, userId: designer.id });
    expect(dup.status).toBe(409);

    const badStage = await admin.agent
      .post(`/products/${productId}/assignments`)
      .send({ stageId: "00000000-0000-0000-0000-000000000000", userId: designer.id });
    expect(badStage.status).toBe(400);

    const badUser = await admin.agent
      .post(`/products/${productId}/assignments`)
      .send({ stageId: stage(3).id, userId: "00000000-0000-0000-0000-000000000000" });
    expect(badUser.status).toBe(400);
  });

  it.each([
    ["the product's owner", () => owner],
    ["an assigned manager", () => assignedManager],
    ["an assignee", () => designer],
    ["an unrelated user", () => stranger],
  ])("does not let %s manage assignments", async (_who, actor) => {
    const other = await createProduct();
    const denied = await actor().agent
      .post(`/products/${other}/assignments`)
      .send({ stageId: stage(3).id, userId: actor().id });
    expect(denied.status).toBe(403);
    expect(await prisma.productStageAssignment.count({ where: { productId: other } })).toBe(0);
  });

  it("removes an assignment, records that too, and takes the user's access with it", async () => {
    const assignment = await prisma.productStageAssignment.findFirstOrThrow({
      where: { productId, userId: designer.id },
    });
    expect((await designer.agent.get(`/products/${productId}`)).status).toBe(200);

    expect((await designer.agent.delete(`/products/${productId}/assignments/${assignment.id}`)).status).toBe(403);
    const removed = await admin.agent.delete(`/products/${productId}/assignments/${assignment.id}`);
    expect(removed.status).toBe(204);

    const history = await prisma.productStageAssignmentHistory.findMany({
      where: { productId },
      orderBy: { actedAt: "asc" },
    });
    expect(history.map((h) => h.action)).toEqual(["ASSIGNED", "UNASSIGNED"]);
    // Their only tie to the product is gone, so it no longer exists for them.
    expect((await designer.agent.get(`/products/${productId}`)).status).toBe(404);
  });

  it("shows the assignments to those who see the whole product, and not to assignees", async () => {
    const shared = await createProduct();
    await assign(shared, 2, designer);
    await assign(shared, 3, reviewer);

    const full = await owner.agent.get(`/products/${shared}`);
    expect(full.body.assignments).toHaveLength(2);
    expect(full.body.assignments[0]).toMatchObject({ user: { id: designer.id }, assignedBy: { id: admin.id } });

    const assignee = await designer.agent.get(`/products/${shared}`);
    expect(assignee.body).not.toHaveProperty("assignments");
  });
});

// ---------------------------------------------------------------------------

describe("Who someone is comes from the database, not from their token", () => {
  it("stops honouring a role the moment it changes, not when the token expires", async () => {
    const temp = await createTestUser(app, "ADMIN", "soon-demoted");
    const productId = await createProduct(owner.id, "Demotion Widget");

    // While an admin, everything is visible and assignments can be managed.
    expect((await temp.agent.get(`/products/${productId}`)).status).toBe(200);

    await prisma.user.update({ where: { id: temp.id }, data: { role: "ENGINEER" } });

    // Same token, no longer an admin: the product vanishes and admin actions fail.
    expect((await temp.agent.get(`/products/${productId}`)).status).toBe(404);
    const denied = await temp.agent
      .post(`/products/${productId}/assignments`)
      .send({ stageId: stage(2).id, userId: temp.id });
    expect(denied.status).toBe(403);
  });

  it("rejects a token for a user who has since been deleted, on every route", async () => {
    const temp = await createTestUser(app, "ADMIN", "soon-deleted");
    expect((await temp.agent.get("/products")).status).toBe(200);

    await prisma.user.delete({ where: { id: temp.id } });

    expect((await temp.agent.get("/products")).status).toBe(401);
    expect((await temp.agent.get("/stages")).status).toBe(401);
  });
});

describe("Admins see everything", () => {
  it("lists every product, in full, including ones nobody is tied to", async () => {
    const lonely = await createProduct(otherOwner.id, "Nobody's Widget");

    const res = await admin.agent.get("/products");
    const entry = res.body.find((p: { id: string }) => p.id === lonely);

    expect(entry).toMatchObject({ view: "full", access: "ADMIN" });
    expect((await admin.agent.get("/stages")).body).toHaveLength(stages.length);
  });
});
