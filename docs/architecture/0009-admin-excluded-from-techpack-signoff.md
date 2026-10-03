# 0009 — ADMIN is excluded from Tech Pack confirmation and approval

## Status

Accepted

## Context

ADR 0007 left SOP-domain authorization as "a plain role gate... not finalized
here." Finalizing it (role table straight from the SOP, `ADMIN` bypassing
every gate — the old module's convention) raised one specific question:
should `ADMIN` also bypass `TechPackConfirmation` (Engineering's sign-off) and
`TechPackApproval` (Management's decision)?

These two records are different in kind from the rest of the Slice A writes.
Creating a Project or uploading a Tech Pack version is ordinary data entry —
who did it doesn't change what the record *means*. A confirmation or an
approval **is** its own meaning: the entire point of the row is "Engineering
looked at this and signed off" / "Management decided this." If `ADMIN` could
also produce either row, the audit trail could say a real review happened
when what actually happened is an administrator clicked a button — exactly
the kind of gap ADR 0005 and ADR 0006 both exist to close elsewhere.

## Decision

`POST` the Engineering confirmation and `POST` the Management approval/
rejection are gated to exactly `ENGINEERING` and `MANAGEMENT` respectively,
with **no `ADMIN` carve-out**. Every other SOP-domain write in Slice A
(creating a Project, creating a Tech Pack, uploading a version, posting a
remark) does include `ADMIN` alongside its primary role, matching the old
module's "admin can do anything" convention. This is a narrow, explicit
exception to that convention — not a wholesale rethink of what `ADMIN` means
in this codebase.

If the real admin is also the person doing Engineering or Management's job
(plausible for a small team), the fix is to give that person the
`ENGINEERING` or `MANAGEMENT` role, not to let `ADMIN` bypass the gate. A
user holds exactly one role, so this is a real choice about who that person
is acting as when they sign off — which is exactly the distinction this ADR
exists to preserve.

## Consequences

- `requireRole("ENGINEERING")` and `requireRole("MANAGEMENT")` (no `"ADMIN"`
  argument) are the two gates in the codebase that look different from every
  other SOP-domain route — worth a comment at each call site pointing back
  here, so it doesn't read as an oversight.
- `ADMIN` still reads everything in the SOP domain (no visibility model like
  ADR 0004 exists here — see ADR 0007, Decision point 6) and still creates
  Projects/Tech Packs/versions/remarks. This ADR narrows exactly two actions,
  not `ADMIN`'s standing generally.
- Diverges, deliberately, from the old module's own `Approval` (ADR 0005),
  where the product's owner — who can be an `ADMIN` or hold any role — *can*
  approve their own product, an explicit accepted trade-off ("no separation
  of duties"). The two domains are allowed to make different calls here; nothing
  requires them to match.
- An admin locked out of confirming/approving because nobody holds the right
  role yet is a seeding/user-management gap, not a bug in this gate — the
  fix is creating or promoting a user to `ENGINEERING`/`MANAGEMENT`.

## Alternatives considered

- **`ADMIN` bypasses every SOP-domain gate, these two included** (the default
  this ADR deviates from) — simpler, and consistent with the rest of Slice A
  and with the old module. Rejected specifically for these two actions: audit
  integrity is exactly what a confirmation/approval row exists to provide,
  and an always-available admin bypass undermines it in a way it doesn't for
  ordinary data-entry actions.
- **A separate "admin override" action that's logged differently from a real
  confirmation/approval** (e.g. a distinct decision value or a flag on the
  row) — would preserve *an* escape hatch while keeping it visibly different
  from a real sign-off. Not built: no concrete need for an override has come
  up yet, and it's a bigger schema/service change than this ADR's scope.
  Worth returning to if an admin is ever genuinely stuck with no one to grant
  the role to.
