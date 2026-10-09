// JSON response shapes for the API — dates are ISO strings on the wire, not
// Date objects. Kept as plain unions/interfaces (no enums) so the web app's
// `erasableSyntaxOnly` config can consume them.

export const APPROVAL_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Final role set (ADR 0010). */
export const USER_ROLES = [
  "ADMIN",
  "FINANCE",
  "PMO",
  "PRODUCT_DESIGNER",
  "ENGINEERING",
  "MANAGEMENT",
  "MERCHANDISER",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** ADR 0010/0011: accounts are deactivated, never deleted. */
  isActive: boolean;
  /** Set by an admin password reset; cleared by this user's own successful
   * change-password. While true, every endpoint except `GET /auth/me` and
   * `POST /auth/change-password` returns 403 (ADR 0011) - the web app must
   * force this user to the change-password screen. */
  mustChangePassword: boolean;
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
  /** Issued-at and expiry, seconds since the epoch (standard JWT claims). */
  iat: number;
  exp: number;
  /** Issued-at again, but milliseconds (ADR 0011) - the standard `iat`
   * above is too coarse to reliably order against a password change that
   * can land in the same second. */
  iatMs: number;
  /** The `UserSession` (ADR 0012) this token was minted for - lets the API
   * reject it the instant that session is revoked, rather than waiting out
   * the token's own short lifetime. */
  sid: string;
}

/** Body of `POST /auth/login`. */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Response of `POST /auth/login` and `POST /auth/refresh` (ADR 0012 - same
 * shape, since restoring a session on page load and refreshing one are the
 * same operation from the caller's point of view). Send `token` as
 * `Authorization: Bearer <token>`. A refresh-token cookie is set alongside
 * this response; there is nothing about it in the body - it's httpOnly.
 */
export interface LoginResponse {
  token: string;
  tokenType: "Bearer";
  /** Access token lifetime in seconds - short (minutes, not hours): refresh
   * before it runs out, silently, via the cookie. */
  expiresIn: number;
  /** How long the *session* tolerates no refresh at all before it can no
   * longer be renewed (ADR 0012) - the web app uses this to time its idle
   * warning and to decide whether it's worth attempting a proactive
   * refresh at all. */
  idleTimeoutSeconds: number;
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
// User management (ADR 0010/0011 in the API). Accounts are created, role-
// changed, deactivated/reactivated and password-reset by an admin - there is
// no self-registration. `ChangePasswordRequest` is the one exception: any
// user can change their own password (needed to clear `mustChangePassword`
// after an admin reset).
// ---------------------------------------------------------------------------

/** Body of `POST /users`. ADMIN only; no password field - the server
 * generates a one-time temporary password, same as a reset (ADR 0011), so
 * the admin never learns a password the user might reuse elsewhere.
 * Response: 201 with a `TemporaryPasswordResponse`. */
export interface CreateUserRequest {
  name: string;
  email: string;
  role: UserRole;
}

/** Body of `PATCH /users/:id/role`. ADMIN only. */
export interface ChangeUserRoleRequest {
  role: UserRole;
}

/** Response of `POST /users` (201) and `POST /users/:id/reset-password`
 * (200). ADMIN only; neither takes a password from the admin - the server
 * generates one (ADR 0011) and sets `user.mustChangePassword`.
 * `temporaryPassword` is returned exactly once - nothing persists it in
 * plaintext, and there's no way to see it again after this response. */
export interface TemporaryPasswordResponse {
  user: UserSummary;
  temporaryPassword: string;
}

/** Body of `POST /auth/change-password`. Any authenticated user, for their
 * own account - the one way to clear `mustChangePassword` after an admin
 * reset. Requires the current password. */
export interface ChangePasswordRequest {
  currentPassword: string;
  /** 8 to 128 characters. */
  newPassword: string;
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
