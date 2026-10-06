// JSON response shapes for the API — dates are ISO strings on the wire, not
// Date objects. Kept as plain unions/interfaces (no enums) so the web app's
// `erasableSyntaxOnly` config can consume them.

export const APPROVAL_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Final role set (ADR 0010). */
export type UserRole =
  | "ADMIN"
  | "FINANCE"
  | "PMO"
  | "PRODUCT_DESIGNER"
  | "ENGINEERING"
  | "MANAGEMENT"
  | "MERCHANDISER";

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

// ---------------------------------------------------------------------------
// SOP domain (ADR 0006/0007/0010 in the API) — Project, TechPack + versions,
// Engineering confirmation / Management approval, Proto Request.
// ---------------------------------------------------------------------------

export const PROJECT_PHASES = ["PROTO", "BULK"] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const PROJECT_STATUSES = ["ACTIVE", "COMPLETED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Shape of `GET /projects`, `GET /projects/:id`, and the response of `POST /projects`. */
export interface Project {
  id: string;
  code: string;
  name: string;
  productName: string;
  productCategory: string | null;
  phase: ProjectPhase;
  status: ProjectStatus;
  protoCompletedAt: string | null;
  completedAt: string | null;
  createdById: string;
  createdBy: UserSummary;
  createdAt: string;
}

/** Body of `POST /projects`. PMO or ADMIN only. */
export interface CreateProjectRequest {
  name: string;
  productName: string;
  productCategory?: string;
}

/** File metadata (ADR 0008) - bytes are reachable only through the
 * authenticated `GET /attachments/:id/download`, never a URL on this object. */
export interface Attachment {
  id: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedBy: UserSummary;
  uploadedAt: string;
  techPackVersionId: string | null;
}

/** One entry in a TechPackVersion's review thread (Stage 3, Engineering half). */
export interface TechPackRemark {
  id: string;
  techPackVersionId: string;
  authorId: string;
  author: UserSummary;
  body: string;
  createdAt: string;
}

/** Body of `POST /tech-packs/:id/versions/:versionNumber/remarks`. ENGINEERING,
 * PRODUCT_DESIGNER or ADMIN; response is the created `TechPackRemark`. */
export interface AddTechPackRemarkRequest {
  body: string;
}

/** Engineering's sign-off on one exact TechPackVersion (Stage 3). Also the
 * response shape of `POST .../confirm`. */
export interface TechPackConfirmation {
  id: string;
  techPackVersionId: string;
  confirmedById: string;
  confirmedBy: UserSummary;
  confirmedAt: string;
}

/** Management's decision on one exact TechPackVersion (Stage 3). */
export interface TechPackApproval {
  id: string;
  techPackVersionId: string;
  decision: ApprovalDecision;
  decidedById: string;
  decidedBy: UserSummary;
  decidedAt: string;
  notes: string | null;
}

/** Body of `POST /tech-packs/:id/versions/:versionNumber/decision`. MANAGEMENT
 * only; `notes` is required when rejecting. */
export interface DecideTechPackVersionRequest {
  decision: ApprovalDecision;
  notes?: string;
}

/** One revision of a TechPack, always nested under `TechPackDetail.versions`
 * (there is no standalone "get one version" endpoint). */
export interface TechPackVersion {
  id: string;
  techPackId: string;
  versionNumber: number;
  notes: string | null;
  uploadedById: string;
  uploadedBy: UserSummary;
  uploadedAt: string;
  /** Oldest first. */
  attachments: Attachment[];
  /** Oldest first. */
  remarks: TechPackRemark[];
  confirmation: TechPackConfirmation | null;
  approval: TechPackApproval | null;
}

/** Shape of `GET /tech-packs/:id/versions` is nested here, newest first (there
 * is no separate endpoint for it) - see `TechPackListItem` for the narrower
 * `GET /tech-packs` list shape. Also the response of `POST /tech-packs`,
 * `POST .../versions`, and the `techPack` field of `POST .../decision`'s
 * response. */
export interface TechPackDetail {
  id: string;
  code: string;
  projectId: string;
  project: { id: string; code: string; name: string; phase: ProjectPhase };
  phase: ProjectPhase;
  createdById: string;
  createdBy: UserSummary;
  createdAt: string;
  voidedAt: string | null;
  voidedById: string | null;
  voidedBy: UserSummary | null;
  voidReason: string | null;
  supersedesId: string | null;
  supersedes: { id: string; code: string } | null;
  /** The TechPack that replaced this one, if Management rejected it. */
  supersededBy: { id: string; code: string } | null;
  /** Newest first. */
  versions: TechPackVersion[];
}

/** Response of `POST /tech-packs/:id/versions/:versionNumber/decision`. On
 * `REJECTED`, `techPack` is the *new* successor TechPack (zero versions of
 * its own yet), not the one just decided on, and `protoRequest` is null. */
export interface DecideTechPackVersionResponse {
  decision: ApprovalDecision;
  techPack: TechPackDetail;
  protoRequest: ProtoRequest | null;
}

/** Shape of each entry in `GET /tech-packs` (narrower than `GET /tech-packs/:id` —
 * no `versions`, `supersedes`/`supersededBy` or `voidedBy`). */
export interface TechPackListItem {
  id: string;
  code: string;
  projectId: string;
  project: { id: string; code: string; name: string };
  phase: ProjectPhase;
  createdById: string;
  createdBy: UserSummary;
  createdAt: string;
  voidedAt: string | null;
  voidedById: string | null;
  voidReason: string | null;
  /** The TechPack this one replaced, if Management rejected it. */
  supersedesId: string | null;
}

/** Shape of `GET /proto-requests`, `GET /proto-requests/:id`, and the
 * `protoRequest` field of `POST .../decision`'s response when approved. */
export interface ProtoRequest {
  id: string;
  code: string;
  projectId: string;
  project: { id: string; code: string; name: string };
  techPackVersionId: string;
  techPackVersion: {
    id: string;
    versionNumber: number;
    techPack: { id: string; code: string };
  };
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Attachment upload policy (ADR 0008 in the API) — shared so the web upload
// form can reject a disallowed file *before* sending it, with the exact same
// rule the API enforces regardless. The API's own copy of these (previously
// in apps/api/src/services/storage/AttachmentStorage.ts) now just re-exports
// them from here, so there is one definition, not two that could drift.
// ---------------------------------------------------------------------------

export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "dwg",
  "dxf",
  "step",
  "stp",
  "png",
  "jpg",
  "jpeg",
] as const;

export function isAllowedAttachmentExtension(originalName: string): boolean {
  const ext = originalName.split(".").pop()?.toLowerCase();
  return ext !== undefined && (ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext);
}
