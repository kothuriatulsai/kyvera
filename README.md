# Kyvera

Kyvera is a business operations platform built for a startup that designs and
manufactures its own products. Instead of tracking product development,
manufacturing, budgets, and expenses across spreadsheets, email, and chat, it
centralizes that workflow in one system that can answer questions like:

- What products are we developing, where are they in the lifecycle, who owns
  them, are they delayed?
- Where is each manufacturing order, which manufacturer, will it arrive on
  time?
- What's budgeted vs. actually spent vs. committed (ordered but unpaid) vs.
  still available?
- Which bank transactions map to which expense category / product / order /
  budget?
- Eventually: what did it actually cost, end-to-end, to develop and
  manufacture a given product?

This is a portfolio project built progressively, module by module, on an
architecture designed to support the full vision without major rewrites.

## Module roadmap

```
Product Development → Manufacturing/Orders → Logistics → Inventory
→ Supplier Management → Budget & Expense Management → Management Dashboard
```

Workflow stages, the data model, versioning, audit trails, and the
permissions model are deliberately not prescribed up front — designing them
is part of the project.

**Module 1 — Product Development** is the current focus: tracking products
through a configurable workflow (stages stored as data, not hardcoded),
recording stage history for audit and delay computation, and versioning
product specs so later modules (e.g. manufacturing orders) can pin to a
specific version.

## Architecture

Monorepo with a clear API boundary between frontend and backend:

```
kyvera/
├── apps/
│   ├── api/                 # Express + TypeScript + Prisma
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── controllers/
│   │   │   ├── services/    # business logic
│   │   │   ├── repositories/# Prisma data access
│   │   │   └── prisma/      # schema.prisma + migrations
│   │   └── tests/
│   └── web/                  # React + TypeScript + Vite
│       └── src/
├── packages/
│   └── shared-types/         # types/enums shared between api & web
├── docs/
│   ├── architecture/         # Architecture Decision Records (ADRs)
│   └── journal/               # dated build log
├── docker-compose.yml
└── README.md
```

Backend request flow: `routes → controllers → services → repositories (Prisma) → database`.

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| ORM | Prisma |
| Frontend | React + TypeScript + Vite |
| API style | Plain REST |
| Auth | Hand-rolled JWT + role-based access (admin/manager/engineer/finance) |
| Testing | Vitest + Supertest |
| Deployment | Docker Compose locally; Railway/Render for a live demo |
| CI | GitHub Actions — lint + typecheck + test on every PR |

See `docs/architecture/` for the reasoning behind these decisions and
`docs/journal/` for a running build log.

## API (Module 1)

### Authentication

Every endpoint except `/health`, `POST /auth/register` and `POST /auth/login`
requires `Authorization: Bearer <token>` and returns `401` without a valid one.
That is *all* it enforces so far: who is calling is now verifiable
(`req.actor`), but nothing yet uses it to decide what they may see or do (roles,
ownership and assignments — see `docs/architecture/0004`). Fields like
`ownerId`, `responsibleUserId` and `decidedById` are still plain request-body
values checked only for "is an existing user", not against the caller.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/register` | `{ name, email, password }` (password 8–128 chars). Creates a user with the least-privileged role (`ENGINEER`); sending a `role` is a `400`. |
| `POST` | `/auth/login` | `{ email, password }` → `{ token, tokenType, expiresIn, user }`. Wrong password and unknown email return the same `401`. |
| `GET` | `/auth/me` | The caller's own user record; needs a token. |

Passwords are hashed with argon2id. Tokens are HS256 JWTs whose claims are only
the user id (`sub`) and `role`, and they live for one hour
(`JWT_EXPIRES_IN_SECONDS`). There is no refresh flow: when a token expires the
client logs in again. The role in a token can be up to an hour out of date if it
changes, which matters once roles are enforced. Configure `JWT_SECRET`
(required, 32+ characters) as described in `apps/api/.env.example`.

`db:seed` gives the seeded users a real hash of a well-known dev password
(`kyvera-dev-password`, or `SEED_USER_PASSWORD`) so you can log in as, for
example, `admin@kyvera.dev`. It is dev data; never seed a shared environment.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/products` | List all products, with live-computed `status` and a `delay` summary (see below). |
| `POST` | `/products` | Create a product. Also creates its v1 `ProductVersion` and opens the first `ProductStageHistory` entry. |
| `GET` | `/products/:id` | Full detail: owner, current stage, versions, stage history, approvals; live `status`/`delay` as above. |
| `GET` | `/products/:id/delay` | Live per-stage delay breakdown (status, elapsed/expected days, delay days) plus the same projected `expectedCompletionDate` stored on the product. |
| `PATCH` | `/products/:id` | Update `name`/`description`/`ownerId`/`status`/`expectedCompletionDate`/`actualCompletionDate`. `status` is derived from delay, so only `BLOCKED` can be set manually; `DELAYED` is rejected with a `400`, and `ON_TRACK` is accepted only to clear a `BLOCKED` product (the stored value is then re-derived). |
| `DELETE` | `/products/:id` | Deletes the product and its versions/stage history. |
| `POST` | `/products/:id/versions` | Create a new `ProductVersion`, bumping `currentVersion`. |
| `POST` | `/products/:id/transition` | Move to the next (`direction: "forward"`, default) or previous (`"backward"`) stage. Can't skip stages; moving backward requires a `reason`. Moving into the final (Approval) stage requires an `approval` decision (see below). Recomputes and persists `expectedCompletionDate`/`status`. |

`expectedCompletionDate` is derived, not a free-form field: on creation (unless
you pass an explicit override) and on every transition, it's recomputed from
`startDate` + each stage's actual duration (completed), live elapsed-or-expected
duration (in progress), or expected duration (not yet reached) — see
`services/delayComputationService.ts`. `status` is kept in sync the same way
(`ON_TRACK`/`DELAYED`), except once a product is manually set to `BLOCKED`,
which the recompute won't overwrite.

The stored `status` column only refreshes on creation/transition, so a product
that has quietly sat in a stage past its expected duration would still read
`ON_TRACK` there. Reads therefore don't trust it: `GET /products` and
`GET /products/:id` compute `status` live from stage timing on every request
(one batched query for all products, then the same pure delay computation)
and add a `delay` summary (`delayed`, `totalDelayDays`, projected
`expectedCompletionDate`). `BLOCKED` is manual and always passes through. The
per-stage breakdown is still `GET /products/:id/delay`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/stages` | The workflow's stage definitions, in `sequenceOrder`. |

### Approvals

Entering the final stage is an approval gate. The transition request must
carry `approval: { decision: "APPROVED" | "REJECTED", decidedById, notes? }`:

- `APPROVED` moves the product into the Approval stage.
- `REJECTED` (with `notes`) instead sends it one stage back, through the normal
  backward path, with the notes as the reason.
- Either way an append-only `approvals` row is written in the same transaction,
  pinned to the product's current `ProductVersion` — this is what Module 2 will
  check before a product can be manufactured.
- Only `ADMIN`/`MANAGER` users may decide (`403` otherwise). With no auth yet
  this checks the role of the user named in `decidedById`, so it is a business
  rule, not a security boundary. See `docs/architecture/0005-approval-records.md`.

## Frontend (Module 1)

`apps/web` is a read-only React + Vite app (React Router) over the API above,
using response types from `packages/shared-types`. Set `VITE_API_URL` to point
it at the API (defaults to `http://localhost:4000`).

**Known gap:** the API now requires a token and the web app has no login screen
yet, so against a real API its pages get `401`. Its tests stub `fetch`, so they
still pass. A login flow is the next frontend piece.

| Route | View |
|---|---|
| `/` | Product list — stage, owner, live status, projected completion. |
| `/delayed` | Products that are currently delayed, worst first. |
| `/products/:id` | Detail: stage timeline with per-stage delay, stage history, versions. |

## Local setup

Prerequisites: Node.js 22+, Docker (for Postgres).

```bash
npm install

# Copy the env template, adjust DATABASE_URL if not using Docker Compose, and
# set JWT_SECRET (the file explains how to generate one)
cp apps/api/.env.example apps/api/.env

# Start Postgres
docker compose up -d postgres

# Apply migrations and seed the workflow stage definitions
npm run db:migrate --workspace apps/api
npm run db:seed --workspace apps/api

# Run the apps
npm run dev --workspace apps/api
npm run dev --workspace apps/web
```

`docker compose up` also builds and runs `api`/`web` themselves, if you'd
rather run everything in containers.

### Quality checks

```bash
npm run lint
npm run typecheck
npm run test
```

These also run in CI on every pull request.
