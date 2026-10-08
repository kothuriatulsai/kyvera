# 0012 — Refresh-token sessions

## Status

Accepted and implemented, 2026-10-08. Revised the same day, before merge:
point 4's rotation write was a plain read-then-update with no condition
tying it to the row it read - see "revised" note under point 4.

## Context

The access token has lived only in memory since the very first auth work:
deliberately, so an XSS payload can't read it out of `localStorage`. The
cost of that choice was never addressed - a reload, or just typing a URL
into the address bar, lost the token and bounced the user back to the login
page, even seconds after they'd logged in. That's the problem this ADR
fixes, with the standard access/refresh split.

## Decision

**1. Access token stays short-lived and memory-only; a new refresh token
carries the session across reloads.** `JWT_EXPIRES_IN_SECONDS` default drops
from 3600 to 900 (15 minutes) - short enough that a leaked access token is
only ever a brief liability. The refresh token is a random 256-bit opaque
secret, not a JWT, stored in an `httpOnly` cookie (`kyvera_refresh`):
`Secure` only in production (plain `http://` in local dev would just never
send it), `SameSite=Strict`, and `Path=/auth` - the browser never attaches
it to a request outside the two endpoints that read it.

**2. A new `UserSession` table, not reused from the web app's own `Session`
type.** The web app already has a `Session` (`{token, user}`, in-memory,
UI-facing); this is a different concept - a server-side row backing the
refresh token - so it gets its own name to keep the two from being confused
in code or in this document. Columns: `userId`, `tokenHash` (SHA-256 of the
current secret - never the secret itself), `previousTokenHash` and
`rotatedAt` (point 4), `userAgent`, `createdAt`, `lastUsedAt`, `expiresAt`,
`revokedAt`. SHA-256, not argon2: argon2's deliberate slowness defends a
low-entropy human password against offline guessing, which is irrelevant to
a 256-bit random value that's already unguessable - here it would only add
cost with no security benefit. `onDelete: Cascade` on the `user` relation
(a deliberate exception to ADR 0006 point 9's `Restrict` convention) since a
session is ephemeral auth state, not an audit trail; nothing needs a dead
user's old sessions to still exist.

The refresh cookie's value is `${sessionId}.${secret}`, not the secret
alone - rotation and reuse detection (point 4) need to look a session up by
id even once its *current* secret has moved on, which a bare secret
wouldn't allow once it's no longer the hash on file.

**3. `POST /auth/refresh` rotates the token on every call and mints a fresh
access token for the same session.** Three outcomes for the secret the
cookie presents: it matches the session's current hash (ordinary rotation -
issue a new secret, a new access token); it matches the *previous* hash,
within a 60-second grace window (point 4); or it matches neither, which
revokes the whole session (reuse detection - a presented secret that's
neither current nor recently-superseded only makes sense if two parties now
hold what was meant to be a single-use value). `POST /auth/logout` revokes
the session identified by the cookie, recognising either the current or the
immediately-previous hash (a courtesy call, not where reuse-detection's
revoke-on-mismatch response belongs); it always resolves successfully,
cookie recognised or not.

**4. The multi-tab race is handled on both ends, not just one.** Two tabs
refreshing at the same moment would otherwise both present the same secret;
whichever request the server processes second would look exactly like reuse
of an already-rotated token and revoke a session that was never actually
compromised.
- *Server*: `previousTokenHash` + `rotatedAt` on the session row. A secret
  matching the previous hash within `ROTATION_GRACE_WINDOW_MS` (60s) is
  treated as the second tab's benign, slightly-stale request - it rotates
  again and succeeds, no revoke. Past that window, the same stale secret is
  reuse for real.
- *Client*: `AuthProvider`'s `withRefreshLock` serializes refresh calls
  across tabs on the same origin via `navigator.locks.request('kyvera-
  refresh', fn)`, so only one tab's request actually reaches the network at
  a time - the cookie is shared storage, so a tab that loses the race simply
  proceeds with whatever the winning tab already established. Where the Web
  Locks API isn't available, this falls back to calling `fn()` directly; the
  server's grace window is the real backstop for that case, not this lock.

  **Revised same day, before merge**: the server's rotation write was
  originally a plain read-then-`update` with nothing tying the write to the
  row it had read - two refreshes landing genuinely concurrently (not the
  client-side lock's sequential near-miss, but both in flight on the server
  at once, e.g. the lock's own fallback path, or two separate devices) could
  both read the same current hash, both pass validation, and then blindly
  overwrite each other's write. The loser's own response cookie would then
  match neither the new current hash nor `previousTokenHash`, and its very
  next use would look exactly like reuse - revoking a session over a request
  that did nothing wrong. Fixed with a compare-and-swap:
  `sessionRepository.rotateIfCurrent` (`updateMany` conditioned on
  `tokenHash` still equalling what was read) replaces the old unconditional
  `rotate`; `rotateSession` is now a small retry loop (bounded at 5
  attempts, defensive - real races resolve on the first retry) that, on a
  lost race (zero rows written), re-reads the session and re-runs the same
  current/recently-superseded/reuse check against the fresher row instead of
  proceeding to write stale data or treating the loss itself as reuse.

**5. Immediate revocation via a `sid` claim.** The access token JWT carries
the session id (`signAccessToken(actor, sessionId)`); `authService.
resolveActor` (called by `authenticate` on every request) now also calls
`sessionService.assertSessionValid(sessionId, userId)`, a narrow query
(`sessionRepository.findValidityById`) that rejects the request if that
session is revoked, expired, or belongs to someone else. Without this, a
revoked session's *access* token would stay usable for however much of its
15-minute life remained - logout, or an admin's "log out everywhere" later,
would be a promise the token itself could still break for up to 15 minutes.
With it, revocation is immediate: an old access token gets a 401 on the very
next request after the session backing it is gone.

**6. Idle timeout and absolute limit are tracked separately, both
configurable via env.** `REFRESH_IDLE_TIMEOUT_SECONDS` (default 1800 = 30
minutes) is measured from `lastUsedAt`, which only moves forward on a
*successful* refresh - never on an ordinary API call, since nothing in this
app polls on a timer (point 8) and the whole point of an idle timeout is
that it reflects real inactivity, not request traffic.
`REFRESH_ABSOLUTE_TTL_SECONDS` (default 43200 = 12 hours) is measured
against `expiresAt`, fixed once at session creation and never extended by
rotation - a session that keeps getting used still ends at its absolute
limit. A session that times out from inactivity is deliberately *not*
revoked (`revokedAt` stays null) - `lastUsedAt` is already frozen, so every
later refresh attempt keeps failing the same way on its own; there's
nothing a revoke flag would add.

**7. CSRF guard on both cookie-authenticated endpoints, on top of
`SameSite=Strict`.** `/auth/refresh` and `/auth/logout` each call
`assertAllowedOrigin`, which 403s unless `Origin` is present and in
`getAllowedOrigins()`. `SameSite=Strict` already stops the cookie attaching
to a genuinely cross-site request in most browsers; this is a second,
explicit layer for a request that somehow still carries it. Both endpoints
are mounted *without* the existing `authenticate` middleware (they're
cookie-based, not Bearer-based) - the Origin check is their self-contained
substitute, not an addition to it.

**8. CORS allows credentials, still only for an explicit origin allowlist.**
`cors({ ..., credentials: true })` - needed because the web app and the API
are different *origins* (different ports) even in local dev where they're
the same *site*, and a credentialed cross-origin request needs the server
to opt in explicitly. `getAllowedOrigins()` already refuses a wildcard
(ADR-predating check in `config.ts`); `credentials: true` makes that
refusal load-bearing in a new way - CORS forbids pairing credentials with
`Access-Control-Allow-Origin: *` outright, so the explicit-allowlist
requirement was never optional here.

**9. Revocation hooks: logout, password change, admin reset, deactivation -
not role change.** `authService.changePassword` and
`userManagementService.deactivateUser` / `resetPassword` each call
`sessionService.revokeAllForUser` after their own update, on top of the
`passwordChangedAt` / `isActive` checks ADR 0011 already had. This is
necessary, not redundant with those checks: `resolveActor`'s `isActive`
check only ever runs on a request that presents an *access* token: without
also revoking the session, a deactivated user's still-valid *refresh*
token would keep minting brand-new access tokens indefinitely. A role
change deliberately does not revoke anything - ADR 0011 point 6 already
makes a role change visible in an open tab within one 403, and a role
change is not the kind of event this ADR treats as "end the session";
forcing a re-login over it would be disproportionate.

**10. Cleanup happens on login, not on a timer.** `createSession` calls
`sessionRepository.deleteStale()` (rows that are revoked or past
`expiresAt`) before creating the new row - the "simple periodic delete"
this project has no background-job infrastructure to run on a schedule.
Piggybacking it on login means the table is swept at the one moment a
write to it was happening anyway.

**11. The web app restores a session silently, refreshes proactively only
if active, and warns before an idle logout.**
- *Silent restore*: `AuthProvider` holds a `checkingInitialSession` state,
  rendering nothing (not the login page) until a mount-time
  `POST /auth/refresh` attempt resolves either way - a reload never flashes
  "logged out" for someone who isn't.
- *Transparent refresh-on-401*: `api/client.ts`'s `rawFetch` retries a
  request once, after a successful refresh via a registered handler, before
  falling through to its existing session-ended/forbidden handling. This is
  what makes an access token that lapsed while idle-but-not-yet-timed-out
  (or just missed by the proactive timer) invisible to whatever the user
  was doing.
- *Proactive refresh*: a one-shot timer (not a recurring poll) fires 60
  seconds before the access token's own expiry and only actually calls
  refresh if `activityRef` (updated on `click`/`keydown`/`popstate`, and on
  regaining window focus) has moved since the last refresh - an idle tab
  lets the timer lapse and relies on the reactive 401-then-refresh path
  above, which will itself fail once the session is truly idle-timed-out.
- *Idle warning*: a second one-shot timer fires 60 seconds before the idle
  timeout and shows a static "you'll be logged out in about a minute"
  notice with a "Stay signed in" button that calls the same refresh path
  directly (bypassing the activity check, since clicking it *is* activity).
  Static, not a live countdown - a ticking clock would need its own
  recurring timer just for cosmetics.

**12. Nothing in this app polls the API on a timer.** Verified explicitly
rather than assumed, since the idle timeout is only real if nothing else is
quietly keeping sessions alive: `AuthProvider`'s `focus` listener calls
`resync()` (a `GET /auth/me`) only on regaining window focus, not on an
interval, and is itself treated as activity for the idle clock's purposes.
No other code schedules a recurring request.

## Consequences

- `LoginResponse` (shared between `/auth/login` and `/auth/refresh`, which
  is why it isn't two separate types) gains `idleTimeoutSeconds`, so the web
  app can schedule the idle warning without a second round trip to learn it.
  `AccessTokenClaims` gains `sid` and the existing `iatMs`.
- `tokenService.signAccessToken` now takes a required `sessionId` parameter
  - every call site (login, refresh, and every test helper that signs a
    token directly) had to be updated to pass one, which is the point: there
    is no longer such a thing as an access token that isn't backed by a row.
- `authenticate` / `resolveActor` do one extra narrow DB read
  (`findValidityById`, a `{userId, revokedAt, expiresAt}` select) on every
  authenticated request. Accepted as the cost of point 5's immediate
  revocation - the same tradeoff ADR 0011 already made for the
  `passwordChangedAt` / `isActive` checks this sits alongside.
- Production constraint worth stating plainly: `SameSite=Strict` requires
  the web app and the API to share a registrable domain (e.g.
  `app.kyvera.example` and `api.kyvera.example`), not merely to both be
  HTTPS. Deploying them to unrelated domains would silently stop the
  refresh cookie from ever being sent.
- `apps/api/tests/sessions.test.ts` (new) covers rotation, the grace-window
  race, a genuinely concurrent double-refresh with the same cookie (point 4,
  as revised), reuse detection outside the grace window, idle timeout, the
  absolute limit, logout, an Origin-less/disallowed-Origin refresh and
  logout being rejected, and that password change / admin reset /
  deactivation each revoke every session for that user while a role change
  does not. The Playwright smoke test gained a reload step between login
  and navigating to Proto Requests, to exercise silent restore end-to-end,
  not just under mocks.

## Alternatives considered

- **Keep the refresh token as a JWT too**, instead of an opaque random
  value looked up in `UserSession` - rejected: a self-contained JWT can't be
  individually revoked or rotated without either a blocklist (which is just
  this table under another name) or accepting that logout doesn't actually
  do anything server-side.
- **Argon2 (or another slow hash) for `tokenHash`** - rejected per point 2:
  it defends against offline guessing of low-entropy secrets, which a
  256-bit random value already isn't vulnerable to; it would only add
  latency to every refresh for no real benefit.
- **Skip the `sid` claim and accept revocation taking effect after the
  access token's own 15-minute lifetime** - rejected: logout is meant to
  end a session now, not in up to 15 minutes, and "log out everywhere" (a
  reasonable future admin feature, already enabled by `revokeAllForUser`)
  would be nearly meaningless without this.
- **A recurring poll (e.g. every few minutes) instead of activity-gated
  one-shot timers** - rejected: it's both less accurate (a poll interval is
  an arbitrary unit disconnected from the token's real expiry) and exactly
  the kind of background traffic that would make the idle timeout fake,
  which point 12 goes out of its way to avoid.
- **A background interval/cron for session cleanup** - rejected for now per
  point 10: this project has no job-scheduling infrastructure yet, and
  piggybacking on login is a simple, sufficient start; a real periodic job
  is a reasonable thing to add later if the table's row count ever justifies
  it.
