// JSON response shapes for the API — dates are ISO strings on the wire, not
// Date objects. Kept as plain unions/interfaces (no enums) so the web app's
// `erasableSyntaxOnly` config can consume them.

export const PRODUCT_STATUSES = ["ON_TRACK", "DELAYED", "BLOCKED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const APPROVAL_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export type UserRole = "ADMIN" | "MANAGER" | "ENGINEER" | "FINANCE";

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
  decidedById: string;
  notes?: string;
}

/** Shape of `GET /products/:id` (newest approval first). */
export interface ProductDetail extends ProductListItem {
  versions: ProductVersion[];
  stageHistory: ProductStageHistoryEntry[];
  approvals: Approval[];
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
  expectedCompletionDate: string;
  totalDelayDays: number;
  delayed: boolean;
  stages: StageDelay[];
}
