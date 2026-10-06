# 0011 — Admin-managed user accounts

## Status

Accepted and implemented, 2026-10-06.

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

**2. `users.passwordChangedAt` (nullable, set on creation and on every admin
reset).** An admin resetting someone's password must invalidate every session
logged in under the old one, not just future logins. `authenticate` now
passes the token's `iat` claim to `resolveActor`, which rejects it if it
predates `passwordChangedAt`. Null (pre-existing seeded rows) skips the
check - there's nothing to compare against.

**3. Admin-only REST surface**, gated by one `requireRole("ADMIN")` on the
whole `/users` router (unlike every other SOP router, there's no "reads are
open to anyone" case here):
`GET /users`, `POST /users` (name/email/role/temporary password),
`PATCH /users/:id/role`, `POST /users/:id/deactivate`,
`POST /users/:id/reactivate`, `POST /users/:id/reset-password`.

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

## Consequences

- `safeUserSelect` gains `isActive` (harmless to expose - it's now shown on
  the Users page). `passwordChangedAt` deliberately does **not** go on
  `safeUserSelect` or the shared `UserSummary` type - nothing needs to
  display it, and keeping it out keeps "what's actually documented as public"
  honest. `resolveActor` reads it through its own narrow
  `findAuthSnapshotById` select instead.
- `tokenService.verifyAccessToken` now returns `issuedAt` alongside the
  existing `id`/`role`, as a separate `VerifiedAccessToken` type rather than
  widening `Actor` - `req.actor` (used everywhere past authentication) still
  carries only identity and role, same as before this ADR.
- `assertPasswordPolicy` (8-128 chars), deleted in ADR 0010 along with
  self-registration, comes back - now used for temporary and reset
  passwords.
- The web `UsersPage` is the one screen with no "reads open to everyone"
  story: a non-admin who navigates to `/users` sees the API's 403 rendered
  like any other error, the same "server enforces it, the UI doesn't
  separately check" posture as the rest of the SOP domain.

## Alternatives considered

- **Soft "pending" state + a separate hard-delete for genuinely unused
  accounts** - rejected: added a second lifecycle state for no concrete need
  yet, and the FK `Restrict` already makes hard-delete non-viable the moment
  a user has done anything real.
- **Only check `passwordChangedAt` at login, not per-request** - rejected:
  the whole point is invalidating sessions already in progress, not just
  future ones. A per-request check costs nothing extra - `authenticate`
  already reloads the user on every request for the role check.
