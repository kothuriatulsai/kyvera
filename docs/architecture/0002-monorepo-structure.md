# 0002 — Monorepo structure

## Status

Accepted

## Context

Kyvera has a clear split between a backend API (Express + Prisma) and a
frontend (React + Vite), plus a growing set of TypeScript types/enums
(workflow stages, roles, order statuses, etc.) that both sides need to agree
on. The project will also grow through several modules
(product development → manufacturing → logistics → inventory → suppliers →
budget/expense → dashboard), so the repo needs a layout that scales without
restructuring every time a module is added.

## Decision

Use a single monorepo with npm workspaces:

```
kyvera/
├── apps/
│   ├── api/
│   └── web/
├── packages/
│   └── shared-types/
├── docs/
│   ├── architecture/
│   └── journal/
├── docker-compose.yml
└── README.md
```

`apps/api` and `apps/web` are independently runnable/deployable apps.
`packages/shared-types` holds types/enums shared between them (e.g. a
`ProductStatus` enum used both by API validation and frontend UI logic),
so the two apps can't silently drift apart on shared domain types.

Within `apps/api`, requests flow `routes → controllers → services →
repositories → database`, keeping HTTP concerns, business logic, and data
access separable even while the codebase is still small.

## Consequences

- One `npm install` and one CI pipeline cover both apps and the shared
  package; no cross-repo version coordination.
- A real API boundary still exists between frontend and backend (plain
  REST, not shared server-side code), which was a deliberate choice
  independent of the monorepo — it forces explicit request/response
  contracts.
- Shared types live in one place (`packages/shared-types`) instead of being
  duplicated or copy-pasted between `apps/api` and `apps/web`.
- New modules (manufacturing, logistics, budget, etc.) extend existing
  `apps/api` layers (new routes/controllers/services/repositories) and
  `apps/web` views rather than requiring new top-level apps or repos.
- Backend layering (routes/controllers/services/repositories) is
  established now, before business logic exists, so later modules follow
  the same pattern instead of retrofitting it.

## Alternatives considered

- **Separate repos for api/web** — cleaner deploy isolation, but adds
  overhead (cross-repo PRs for any change touching shared types, separate
  CI/versioning) that isn't justified for a single-developer portfolio
  project. Rejected for now; revisit if the project ever needs independent
  teams/deploy cadences per app.
- **No shared-types package, duplicate types per app** — simpler initially,
  but risks silent drift between API contracts and frontend assumptions as
  more modules are added. Rejected.
- **tRPC instead of REST (which would blur the monorepo's app boundary)** —
  would remove the need to hand-write request/response contracts, but the
  explicit REST contract work is itself a stated learning goal of the
  project. Rejected, at least initially.
