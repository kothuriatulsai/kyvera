# 0011 — Admin-managed user accounts

## Status

Accepted and implemented, 2026-10-07. Revised twice before merge from an
initial version where an admin chose a user's password directly, both on
reset and on creation - see point 2 and "Alternatives considered".

## Context

ADR 0010 removed public self-registration and left accounts entirely
seed-driven, with an admin "create user" feature deferred. That's now needed:
someone has to be able to onboard a new hire, fix a typo'd email, move
someone to a different role, and - inevitably - deal with someone leaving or
a compromised password, all without touching the database by hand.

Every SOP relation to `User` is `onDelete: Restrict` (ADR 0006, point 9), so
a real `DELETE` on a user who has ever created, confirmed, approved, or
uploaded anything was never actually available as an option - the schema
already settles "deactivate, don't delete" before this ADR states it.

## Decision

**1. `users.isActive` (default `true`).** Deactivation, not deletion, is the
only way to remove someone's access. Checked twice: `authService.login`
treats an inactive user identically to a wrong password (same message, same
dummy-verify timing - deactivation is not something a login attempt can
distinguish from a bad password), and `authenticate` rejects an inactive
user's token on every subsequent request, via the same fresh-reload-per-
request mechanism that already demotes a changed role instantly.

**2. An admin never learns or chooses a user's password - on reset or on
creation.** The first pass of this ADR had `POST /users/:id/reset-password`
take a new password from the admin directly, and `POST /users` took an
admin-chosen `temporaryPassword` for a brand new account. Both revised
before merge, the same way: each takes no password field at all and
generates a one-time temporary password server-side (`passwordService.
generateTemporaryPassword`, 16 random URL-safe characters), returned exactly
once in the response (`TemporaryPasswordResponse.temporaryPassword`) for the
admin to relay to the user. Nothing persists it in plaintext, and there is no
way to see it again after that response - only another reset.

Both set `users.mustChangePassword = true` (a brand new account is no
different from a reset one here - either way, the only password on file is
one the admin saw, not one the user chose). While set, `authenticate`
blocks every endpoint except `GET /auth/me` and the new
`POST /auth/change-password` with a 403 (`requirePasswordChanged`
middleware) - a temporary password the admin saw is not a real password the
user has chosen, so nothing else is usable until they replace it themselves.
`change-password` requires the *current* password (proving it's really them,
not an admin acting on their behalf) and clears the flag on success. The web
app forces this via `RequireAuth`: whenever `session.user.mustChangePassword`
is set, every route but `/account` redirects there.

Both the temporary password and the user's own replacement for it still
update `users.passwordChangedAt` (unchanged from the first pass of this
ADR): nullable, set on creation and on every password change, self-service
or admin-forced. `authenticate` passes the access token's issue time to
`resolveActor`, which rejects it if it predates `passwordChangedAt` - this
is what makes a reset (or a self-service change) invalidate every session
already logged in under the old password, not just future logins. The
comparison needed millisecond precision, not the JWT's standard `iat` (whole
seconds): a login and a reset landing in the same wall-clock second made the
naive comparison ambiguous. `signAccessToken` adds a custom `iatMs` claim
for exactly this check.

**3. Admin-only REST surface**, gated by one `requireRole("ADMIN")` on the
whole `/users` router (unlike every other SOP router, there's no "reads are
open to anyone" case here):
`GET /users`, `POST /users` (name/email/role - no password field, per point
2), `PATCH /users/:id/role`, `POST /users/:id/deactivate`,
`POST /users/:id/reactivate`, `POST /users/:id/reset-password` (no body
either). `POST /auth/change-password` (current + new password) is the one
self-service exception, open to any authenticated user for their own account.

**4. The system can't lock itself out of user management.** An admin can't
deactivate their own account, and can't leave zero active admins - checked
before a deactivation or a role change away from `ADMIN`. In practice only
the role-change path can actually trigger this (an admin demoting themselves
while they're the only one active): if a *different* admin is the one acting,
they themselves are still an active admin afterward, so the count never
reaches zero through someone else's action. The same guard is still called
from `deactivateUser` as a defensive no-op, documented at the call site,
rather than removed - cheap insurance against a future change (e.g. an
"admin acts on someone's behalf without being active" path) making it
reachable again.

**5. Changing a user's role in the web app requires an explicit confirm
step**, not a change that fires the moment the `<select>` changes: `UserRow`
holds the chosen role as pending local state until "Change" is clicked, then
shows "Change X's role to Y?" with its own Confirm/Cancel before calling the
API. A role change is consequential enough (it can revoke or grant real
authority immediately) that a stray click selecting the wrong option in a
dropdown must not be able to submit it by itself.

**6. The web app resyncs the session on any 403 and on regaining window
focus**, not just at login. `api/client.ts` gained a `setForbiddenHandler`
alongside the existing 401 one; `AuthProvider` uses it (and a `focus`
listener) to re-fetch `GET /auth/me` and replace `session.user` wholesale.
If the role changed, it also shows a dismissible "Your role was changed to
X" notice. This is what makes `mustChangePassword` and a role change both
take effect in an already-open tab without a manual refresh - an admin
forcing either one is exactly the kind of out-of-band change a 403 is
already a symptom of.

**7. A role-restricted page a visitor can't use renders the same "Page not
found" as an unknown route**, not the API's 403 message. `/users` is wrapped
in a new `RequireRole` component (mounted inside `RequireAuth`) that checks
`session.user.role` on the client and renders the shared `NotFoundPage`
component on a mismatch - the page's own data fetch never even starts. This
is a deliberate, narrow exception to this codebase's general "the UI doesn't
separately check, the server enforces it" posture (restated as recently as
ADR 0010's README section): existing SOP screens gate *actions* this way
(hide the button, let the API 403 if someone gets there anyway) but have
never had a reason to gate an entire *route's existence* before, because
every prior screen was readable by any authenticated user. `/users` is the
first page where even reading it is restricted, and revealing "you're
logged in, this route exists, but you may not see it" is itself information
this ADR chooses not to leak.

## Consequences

- `safeUserSelect` and the shared `UserSummary` type gain `isActive` and
  `mustChangePassword` (both harmless to expose - the web app needs the
  second one to force the redirect). `passwordChangedAt` deliberately does
  **not** go on either - nothing needs to display it, and keeping it out
  keeps "what's actually documented as public" honest. `resolveActor` reads
  it through its own narrow `findAuthSnapshotById` select instead.
- `tokenService.verifyAccessToken` now returns `issuedAt` (milliseconds)
  alongside the existing `id`/`role`, as a separate `VerifiedAccessToken`
  type rather than widening `Actor` - `req.actor` (used everywhere past
  authentication) still carries only identity and role. `resolveActor`'s
  return type (`ResolvedActor`) similarly adds `mustChangePassword` without
  putting it on `Actor` itself; `authenticate` stashes it on `req.
  mustChangePassword` instead, read only by `requirePasswordChanged`.
- `assertPasswordPolicy` (8-128 chars), deleted in ADR 0010 along with
  self-registration, comes back only for the self-service change-password -
  not for user creation or an admin's reset, both of which generate their
  own temporary password already guaranteed to fit.
- `createUser` and `resetPassword` in `userManagementService.ts` are now
  near-identical shapes (generate a password, hash it, set
  `mustChangePassword`) that happen to go through different repository calls
  (`create` vs `updatePassword`) because one is inserting a row and the
  other is updating one - not pulled into a shared helper beyond
  `generateTemporaryPassword` itself, since there's nothing else to share
  between "create a row" and "update a row."
- The forced-password-change gate and the self-service change endpoint both
  live logically "in front of" the role-gated SOP routers, and are mounted
  accordingly in `routes/index.ts`: `/auth/me` and `/auth/change-password`
  are reachable because they authenticate directly inside `authRoutes`,
  before `requirePasswordChanged` is ever mounted - not because of an
  exemption list inside that middleware.

## Alternatives considered

- **An admin chooses the password directly, on reset and/or on creation**
  (this ADR's own first pass, both times) - rejected on review: it means the
  admin now knows a password the user might reuse elsewhere, for no benefit
  over generating one, and gave no signal that the password was
  admin-assigned rather than chosen by the user. A generated one-time
  password plus a forced change gets the same "get someone into their
  account" outcome without that trust problem, and treating creation and
  reset the same way means there's only one password-handling story to
  reason about, not two.
- **Soft "pending" state + a separate hard-delete for genuinely unused
  accounts** - rejected: added a second lifecycle state for no concrete need
  yet, and the FK `Restrict` already makes hard-delete non-viable the moment
  a user has done anything real.
- **Only check `passwordChangedAt` at login, not per-request** - rejected:
  the whole point is invalidating sessions already in progress, not just
  future ones. A per-request check costs nothing extra - `authenticate`
  already reloads the user on every request for the role check.
- **Let `/users` 403 render like any other SOP-domain restriction** (this
  ADR's own first pass, point 7) - rejected on review: unlike an action
  button's visibility, a restricted *route* existing at all is itself
  information worth not confirming to someone it doesn't apply to.
