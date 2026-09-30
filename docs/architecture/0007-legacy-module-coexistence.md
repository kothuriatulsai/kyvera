# 0007 — Coexisting with the legacy generic-lifecycle module until cutover

## Status

Accepted

## Context

The agreed direction is to build the SOP-based domain alongside the existing
Module 1 (the generic 9-stage lifecycle: `Product`, `ProductVersion`,
`StageDefinition`, `ProductStageHistory`, `Approval`,
`ProductStageAssignment*`, `StageProgressNote`), without modifying it, until
SOP-based Slice A works — at which point the old module is removed. This ADR
records how the two coexist in the meantime, so Slice A isn't built ad hoc,
and what "don't modify the old module" is taken to mean in practice.

## Decision

**1. Same database, same `schema.prisma`, disjoint tables.** No foreign key
from a new SOP table to any old-module table, and none the other way. The two
domains share nothing at the data level except `User`.

**2. `User` is shared identity, touched additively only.** New SOP-domain
relations (`Project.createdBy`, `TechPackVersion.uploadedBy`, etc.) are added
to `User` as new named relations, the same way every existing domain relation
already has its own name (`ProductOwner`, `VersionCreator`, ...). This isn't
"modifying the old module" in the sense meant by the directive above — its
services and business logic are untouched; `User` is the identity table every
domain in this app authenticates against, old and new alike.

**3. New backend layers, not shared ones.** `routes/projectRoutes.ts`,
`controllers/projectController.ts`, `services/projectService.ts`,
`repositories/projectRepository.ts` (and one set per new entity), mounted
alongside the existing `/products` and `/stages` routers under their own paths
(`/projects`, `/tech-packs`, ...). What *is* reused is true infrastructure,
not business logic: `authenticate` middleware, `asyncHandler`,
`requestParsing` helpers, `errors.ts`, the uuid-param middleware, `config.ts`,
`prismaClient.ts` — the same way `authController`/`userService` already sit
beside the product code today without being part of "the old module."

**4. `packages/shared-types` gets new files** (e.g. `sop.ts`), exported
alongside the existing product types, not edited into them.

**5. Frontend: new pages/routes added beside the existing ones.** Which nav
items point where is a UI decision for when Slice A's frontend is built, not
this ADR.

**6. Authorization for the new domain starts from the SOP's own role table**
(§3 — PMO creates/coordinates, Product Designer authors, Engineering confirms,
Management approves, Finance uploads POs, Merchandiser tracks execution) —
checked against the actor's `role`, not ADR 0004's assignment-based,
per-stage-visibility model. That model exists to hide *which stage a
contributor is on* from the rest of a product's timeline, a confidentiality
need the SOP doesn't state for Projects/Tech Packs. A plain role gate is the
working assumption for Slice A's services; this is a service-layer decision,
not schema, and isn't finalized here.

**7. Role expansion is additive, not a rename.** `UserRole` gains `PMO`,
`PRODUCT_DESIGNER`, `ENGINEERING`, `MANAGEMENT`, `MERCHANDISER` as new enum
values. `MANAGER` and `ENGINEER` are **not** renamed or removed. This is a
deliberate deviation from the earlier note that existing `MANAGER`/`ENGINEER`
users get "mapped in migration" — see Consequences.

**8. Removal, when it happens, is one PR.** The old module's Prisma models,
their tables (one down migration), routes/controllers/services/repositories,
and frontend pages are deleted together, tracked as its own journal
entry/follow-up ADR at that time — not speculatively planned now.

## Consequences

- Two independent object graphs in one schema file makes `schema.prisma`
  longer, but each domain stays simple to reason about on its own — no query
  ever needs to join across domains.
- `User` accumulates relation fields from both domains for as long as they
  coexist. When the old module is removed (point 8), its relation names on
  `User` (`ProductOwner`, `VersionCreator`, `StageResponsible`,
  `StageExitedBy`, `ApprovalDecider`, the three assignment relations,
  `ProgressNoteAuthor`) are deleted in the same cleanup.
- Two parallel sets of routes/controllers/services/repositories exist at once
  — deliberate duplication, not sloppiness. A shared abstraction over both
  domains would mean designing that abstraction before Slices B–D are even
  specified, which is exactly the premature-generalization ADR 0003's
  "workflow as data, not hardcoded guesses" already argues against elsewhere
  in this project.
- **Role rename deferred, and this is a direct correction to the earlier
  wording** ("existing MANAGER/ENGINEER mapped in migration"). A real
  data rename (`MANAGER` → `MANAGEMENT`, `ENGINEER` → `ENGINEERING`, old
  values dropped) would force every reference to `UserRole.MANAGER` /
  `UserRole.ENGINEER` across the old module's services and ~200 existing tests
  to be touched, or the build stops compiling — exactly what "don't modify the
  old module" rules out while it's still the running system. So: the new SOP
  roles get their own enum values now, existing users/tests/checks are
  untouched, and the consolidation (dropping the two old values and remapping
  any real users who used them) happens in the same cleanup PR as point 8,
  where it's safe to touch the old module because it's being deleted anyway.
  **Flagging for confirmation** — say if the rename should happen now instead
  and the old module's ~handful of `MANAGER`/`ENGINEER` references should be
  mechanically updated as part of Slice A after all.
- New users created for SOP flows (a PMO, a Product Designer, ...) get the new
  role values directly; nothing changes for existing seeded/dev users.

## Alternatives considered

- **Prisma multi-schema** (`multiSchema` preview feature, separate Postgres
  schemas/namespaces per domain) — rejected as unnecessary ceremony: the two
  domains use disjoint table names already (no collision risk), and a preview
  feature adds migration risk CI doesn't need to take on for a portfolio
  project whose pipeline already exercises `migrate deploy` from an empty
  database.
- **Rename `MANAGER`/`ENGINEER` now**, exactly as the earlier note describes —
  rejected for this pass; see the flagged Consequences item above. This is the
  one place in these two ADRs where I've gone against the stated direction
  rather than just filling a gap it left open, so it's called out rather than
  silently done.
- **A shared "workflow entity" abstraction** across old and new domains —
  rejected; see Consequences (nothing to abstract over yet, with only one
  slice of the new domain specified).
- **Reuse ADR 0004's assignment/visibility model for the new domain** —
  rejected for Slice A; see Decision point 6. Could be revisited if a real
  row-level confidentiality need shows up for Projects/Tech Packs.
