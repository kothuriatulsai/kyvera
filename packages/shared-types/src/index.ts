// JSON response shapes for the API — dates are ISO strings on the wire, not
// Date objects. Kept as plain unions/interfaces (no enums) so the web app's
// `erasableSyntaxOnly` config can consume them.

export const PRODUCT_STATUSES = ["ON_TRACK", "DELAYED", "BLOCKED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const APPROVAL_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export type UserRole = "ADMIN" | "MANAGER" | "ENGINEER" | "FINANCE";

/**
 * Who the viewer is *to a product* (ADR 0004), decided per product, not from
 * their global role: an admin, the product's owner, a manager assigned to it,
 * or an assignee. The first three see the whole product and hold authority over
 * it; an assignee sees only their own stages.
 */
export type AccessLevel = "ADMIN" | "OWNER" | "MANAGER" | "ASSIGNEE";
export type FullAccessLevel = Exclude<AccessLevel, "ASSIGNEE">;

/** When an assignee's stage happens, without revealing the rest of the workflow. */
export type ReadinessState = "completed" | "open_now" | "up_next" | "upcoming";
export interface ReadinessHint {
  state: ReadinessState;
  /** Set only while the stage has not opened yet. */
  opensInDays: number | null;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

/**
 * Who is calling, as proven by a verified access token. Deliberately just
 * identity and role — assignments and ownership can change between logins, so
 * they are looked up per request rather than baked into the token.
 */
export interface AuthActor {
  id: string;
  role: UserRole;
}

/** Claims inside the access token (a JWT signed with HS256). */
export interface AccessTokenClaims {
  /** The user id. */
  sub: string;
  role: UserRole;
  /** Issued-at and expiry, seconds since the epoch. */
  iat: number;
  exp: number;
}

/**
 * Body of `POST /auth/register`. There is intentionally no `role`: public
 * registration always creates the least-privileged role, and sending one is a
 * 400. Response: 201 with the created `UserSummary`.
 */
export interface RegisterRequest {
  name: string;
  email: string;
  /** 8 to 128 characters. */
  password: string;
}

/** Body of `POST /auth/login`. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** Response of `POST /auth/login`. Send `token` as `Authorization: Bearer <token>`. */
export interface LoginResponse {
  token: string;
  tokenType: "Bearer";
  /** Token lifetime in seconds. There is no refresh flow yet: log in again. */
  expiresIn: number;
  user: UserSummary;
}

export interface StageDefinition {
  id: string;
  name: string;
  sequenceOrder: number;
  expectedDurationDays: number;
}

/**
 * A product as stored. This is the shape inside write responses (create /
 * update / transition), where `status` is the persisted snapshot. Reads use
 * `ProductListItem`, whose `status` is live-computed.
 */
export interface ProductSummary {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  owner: UserSummary;
  currentStageId: string | null;
  currentStage: StageDefinition | null;
  currentVersion: number;
  status: ProductStatus;
  startDate: string | null;
  expectedCompletionDate: string | null;
  actualCompletionDate: string | null;
  createdAt: string;
}

/** Live delay rollup on read responses — the per-stage detail is `ProductDelay`. */
export interface ProductDelaySummary {
  delayed: boolean;
  totalDelayDays: number;
  /** Projected from live stage timing; unlike `expectedCompletionDate`, never stale. */
  expectedCompletionDate: string;
}

/**
 * Row shape of `GET /products`. `status` is computed on every read from live
 * stage timing (BLOCKED, being manual, is passed through), not read from the
 * stored column.
 */
export interface ProductListItem extends ProductSummary {
  /** Discriminant: the viewer sees the whole product. See `AssigneeProductSummary`. */
  view: "full";
  access: FullAccessLevel;
  delay: ProductDelaySummary;
}

export interface ProductVersion {
  id: string;
  productId: string;
  versionNumber: number;
  spec: string | null;
  createdAt: string;
  createdById: string;
  createdBy: UserSummary;
}

export interface ProductStageHistoryEntry {
  id: string;
  productId: string;
  stageId: string;
  stage: StageDefinition;
  enteredAt: string;
  exitedAt: string | null;
  actualDurationDays: number | null;
  delayed: boolean;
  delayReason: string | null;
  responsibleUserId: string | null;
  responsibleUser: UserSummary | null;
  /** Who pressed the button to move the product out of this stage. */
  exitedById: string | null;
  /** True if it advanced without every assignee having marked themselves ready. */
  forcedExit: boolean;
}

/**
 * An approval decision on one exact product version. Append-only: a rejection
 * followed by a later approval is two entries. Module 2 asks "is there an
 * APPROVED entry for this product + this version".
 */
export interface Approval {
  id: string;
  productId: string;
  productVersionId: string;
  productVersion: { versionNumber: number };
  stageId: string;
  decision: ApprovalDecision;
  decidedById: string;
  decidedBy: UserSummary;
  decidedAt: string;
  notes: string | null;
}

/** Body of the optional `approval` field on `POST /products/:id/transition`. */
export interface ApprovalRequest {
  decision: ApprovalDecision;
  /** Required when rejecting. There is no `decidedById`: the decider is the authenticated user. */
  notes?: string;
}

/** Shape of `GET /products/:id` (newest approval first). */
export interface ProductDetail extends ProductListItem {
  versions: ProductVersion[];
  stageHistory: ProductStageHistoryEntry[];
  approvals: Approval[];
  assignments: StageAssignment[];
  progressNotes: StageProgressNote[];
}

export type StageProgress = "completed" | "in_progress" | "not_started";

export interface StageDelay {
  sequenceOrder: number;
  status: StageProgress;
  durationDays: number;
  expectedDurationDays: number;
  delayDays: number;
  delayed: boolean;
}

/** Shape of `GET /products/:id/delay`. */
export interface ProductDelay {
  view: "full";
  expectedCompletionDate: string;
  totalDelayDays: number;
  delayed: boolean;
  stages: StageDelay[];
}

// ---------------------------------------------------------------------------
// Stage assignments and progress notes (ADR 0004)
// ---------------------------------------------------------------------------

/** A user assigned to one stage of one product, as seen by those who see the whole product. */
export interface StageAssignment {
  id: string;
  productId: string;
  stageId: string;
  stage: StageDefinition;
  userId: string;
  user: UserSummary;
  assignedAt: string;
  assignedById: string;
  assignedBy: UserSummary;
  /** The assignee's own "done with this stage" mark; cleared whenever the stage is re-entered. */
  readyAt: string | null;
}

/** A progress/delay note left on a stage, as seen by those who see the whole product. */
export interface StageProgressNote {
  id: string;
  productId: string;
  stageId: string;
  userId: string;
  user: { id: string; name: string };
  note: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// The assignee view: what someone assigned to some stages of a product sees.
// Only their own stages, each with a readiness hint. No other stage's name,
// status or history; no product status, dates, owner, versions or approvals; no
// other users.
// ---------------------------------------------------------------------------

export interface AssigneeStageDelay {
  durationDays: number;
  expectedDurationDays: number;
  delayDays: number;
  delayed: boolean;
}

export interface AssigneeStage {
  /** Send this to `POST /products/:id/assignments/:assignmentId/ready`. */
  assignmentId: string;
  stage: { id: string; name: string; expectedDurationDays: number };
  readyAt: string | null;
  readiness: ReadinessHint;
  delay: AssigneeStageDelay | null;
}

export interface AssigneeStageHistoryEntry {
  enteredAt: string;
  exitedAt: string | null;
  actualDurationDays: number | null;
  delayed: boolean;
  delayReason: string | null;
}

export interface AssigneeStageNote {
  id: string;
  note: string;
  createdAt: string;
  /** Authors are not named to their colleagues: only whether a note is yours. */
  isMine: boolean;
}

export interface AssigneeStageDetail extends AssigneeStage {
  history: AssigneeStageHistoryEntry[];
  notes: AssigneeStageNote[];
}

interface AssigneeProductBase {
  view: "assignee";
  access: "ASSIGNEE";
  id: string;
  name: string;
  description: string | null;
}

export interface AssigneeProductSummary extends AssigneeProductBase {
  stages: AssigneeStage[];
}

export interface AssigneeProductDetail extends AssigneeProductBase {
  stages: AssigneeStageDetail[];
}

/** The delay view for an assignee: just their stages, and no product-level projection. */
export interface AssigneeDelay {
  view: "assignee";
  stages: AssigneeStage[];
}

// ---------------------------------------------------------------------------
// What the endpoints return depends on who is asking. Narrow on `view`.
// ---------------------------------------------------------------------------

/** `GET /products`: each entry is shaped for the viewer's access to that product. */
export type ProductListEntry = ProductListItem | AssigneeProductSummary;

/** `GET /products/:id` and `POST /products/:id/transition`. */
export type ProductDetailView = ProductDetail | AssigneeProductDetail;

/** `GET /products/:id/delay`. */
export type ProductDelayView = ProductDelay | AssigneeDelay;

/**
 * `POST /products`. A creator who ends up with no relationship to the product
 * (the owner is a request field) gets only what they supplied, not the product.
 */
export interface CreatedProductStub {
  id: string;
  name: string;
}
export type CreateProductResponse = ProductDetailView | CreatedProductStub;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/** Body of `POST /products/:id/transition`. */
export interface TransitionRequest {
  direction?: "forward" | "backward";
  /** Required when moving backward. */
  reason?: string;
  /** Still a body field; ADRs 0004/0005 do not say where it should come from. */
  responsibleUserId?: string;
  /** Required to move into the final stage. Admin, owner or assigned manager only. */
  approval?: ApprovalRequest;
  /**
   * Advance a stage that has several assignees although not all have marked
   * themselves ready. Admin, owner or assigned manager only; recorded as
   * `forcedExit`. Without it that case is a 409.
   */
  force?: boolean;
}

/** Body of `POST /products/:id/assignments` (admin only). Response: 201 with a `StageAssignment`. */
export interface AssignUserRequest {
  stageId: string;
  userId: string;
}

/** Response of `POST /products/:id/assignments/:assignmentId/ready`. */
export interface MarkReadyResponse {
  assignmentId: string;
  stageId: string;
  readyAt: string;
}

/** Body of `POST /products/:id/stages/:stageId/notes`. Response: 201 with an `AddProgressNoteResponse`. */
export interface AddProgressNoteRequest {
  /** 1 to 2000 characters. */
  note: string;
}

export interface AddProgressNoteResponse {
  id: string;
  stageId: string;
  note: string;
  createdAt: string;
}
