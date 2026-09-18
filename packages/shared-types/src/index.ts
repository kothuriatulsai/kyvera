// JSON response shapes for the API — dates are ISO strings on the wire, not
// Date objects. Kept as plain unions/interfaces (no enums) so the web app's
// `erasableSyntaxOnly` config can consume them.

export const PRODUCT_STATUSES = ["ON_TRACK", "DELAYED", "BLOCKED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export type UserRole = "ADMIN" | "MANAGER" | "ENGINEER" | "FINANCE";

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface StageDefinition {
  id: string;
  name: string;
  sequenceOrder: number;
  expectedDurationDays: number;
}

/** Row shape of `GET /products` (and of the product inside write responses). */
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

/** Shape of `GET /products/:id`. */
export interface ProductDetail extends ProductSummary {
  versions: ProductVersion[];
  stageHistory: ProductStageHistoryEntry[];
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
