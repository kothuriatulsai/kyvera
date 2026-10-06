# 0010 — Retire the generic lifecycle module; final role set

## Status

Accepted and implemented, 2026-10-06.

## Context

ADR 0007 point 8 set the condition for removing the generic 9-stage lifecycle
module (`Product`, `ProductVersion`, `StageDefinition`, `ProductStageHistory`,
`Approval`, `ProductStageAssignment(+History)`, `StageProgressNote`, and the
API/web layers built on them): once the SOP-based Slice A (Stages 1–3) works
end to end, the old module is deleted in one PR. Slice A's backend and web UI
are both built and merged (`feat/sop-slice-a`, `feat/sop-slice-a-ui`), so that
condition is met. This ADR records what was removed, the deferred role-set
decision ADR 0007 flagged, and one new decision that removal forced: how
accounts get created once the old module's self-registration endpoint is
gone.

## Decision

**1. The old module is deleted outright, not archived.** Models and their
migration (tables dropped), repositories, services, controllers, routes,
tests, seed data, web pages/components, nav links, and the corresponding
`packages/shared-types` exports are all removed in this PR, branch
`chore/retire-generic-lifecycle`. `ApprovalDecision` is kept — it's shared
with `TechPackApproval`, not exclusive to the old module's `Approval` model.

**2. `UserRole` is narrowed to seven values**, resolving the question ADR
0007's Decision point 7 and Consequences deliberately left open:
`ADMIN, FINANCE, PMO, PRODUCT_DESIGNER, ENGINEERING, MANAGEMENT, MERCHANDISER`.
`MANAGER` and `ENGINEER` are dropped, not renamed into `MANAGEMENT`/
`ENGINEERING` — this is dev data with no real users to preserve, so the
simpler move is to delete the legacy-role accounts rather than remap them onto
roles that mean something different in the SOP (a `MANAGER` was a per-product
assignee under ADR 0004's model; `MANAGEMENT` is a fixed SOP role with its own
gate). The seed now creates exactly one user per final role: `admin@`, `pmo@`,
`designer@`, `engineering@`, `management@`, `finance@`, `merchandiser@`.

**3. The migration order is deliberately not the order a plain schema diff
would produce.** Old-module tables (and their foreign keys) are dropped
first; only then are `MANAGER`/`ENGINEER` users deleted; only then is
`user_role` narrowed. Doing it in this order means the `DELETE FROM users`
step can fail loudly on a real foreign-key violation if any SOP row
(`Project.createdBy`, `TechPack.createdBy`/`voidedBy`,
`TechPackVersion.uploadedBy`, a remark/confirmation/approval/attachment) still
belongs to one of those users — every SOP relation to `User` is
`onDelete: Restrict` (ADR 0006, point 9), so this is enforced by the database,
not by a script that could be wrong. In this repo's dev database nothing hit
that case. The migration doesn't reset `prj_code_seq`/`tp_code_seq`/
`pr_code_seq`; a developer who wants codes to restart at `000001` runs
`prisma migrate reset` themselves.

**4. Public self-registration is removed, not redirected to a new default
role.** `POST /auth/register` always minted the least-privileged role —
`ENGINEER` before this PR. There is no longer a role that's safe to hand to
an anonymous caller: Slice B gives `FINANCE` a real permission (uploading
POs), and every other role is either `ADMIN` or a specific SOP function. Changing
the default to any real role would let self-registration silently self-grant
that permission, which is a worse problem than the endpoint being gone.
Accounts come from the seed only for now; an admin "create user" endpoint is
future work, not scoped here.

## Consequences

- Nothing SOP-side imports anything removed here — the two domains never
  shared code below `errors.ts`/`selects.ts`/`authenticate`/`requireRole`
  (ADR 0007, point 3), so this PR touches no SOP service or controller logic,
  only its own tests' now-smaller role matrix (`ALL_SESSIONS` in
  `apps/web/src/test/fixtures.ts` drops `MANAGER`/`ENGINEER`, which several
  SOP test files already filtered over dynamically and needed no further
  change).
- There is currently no way to create a user through the running API at all.
  Acceptable for a portfolio project still seed-driven; worth revisiting
  before any real deployment.
- ADRs 0003, 0004 and 0005 (workflow-as-data, stage-level access control,
  approval records) describe a module that no longer exists; each is marked
  superseded by this ADR rather than deleted, so the design reasoning stays
  readable. ADR 0006 (entity model/ID scheme), ADR 0007 (coexistence — now
  historical, its point 8 is what this ADR fulfills), ADR 0008 (attachment
  storage) and ADR 0009 (admin exclusion from Tech Pack sign-off) all
  describe the SOP domain itself and remain current, unchanged.

## Alternatives considered

- **Remap `MANAGER`→`MANAGEMENT` and `ENGINEER`→`ENGINEERING`** instead of
  deleting those users — rejected (Decision point 2): the roles don't mean
  the same thing, and there's no real user data here forcing a migration
  path.
- **Default self-registration to an existing role instead of removing the
  endpoint** — rejected (Decision point 4): no role is both low-privilege and
  harmless once `FINANCE` has a real capability.
- **Reset the code sequences in the migration itself** — rejected per the
  user's direction: left as a manual `prisma migrate reset` so the decision
  to renumber existing dev codes is explicit, not a side effect of this PR.
