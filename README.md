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

No auth yet — `ownerId`/`responsibleUserId` reference existing `users` rows
directly (seeded via `db:seed`) until the JWT/role-based auth module lands.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/products` | List all products. |
| `POST` | `/products` | Create a product. Also creates its v1 `ProductVersion` and opens the first `ProductStageHistory` entry. |
| `GET` | `/products/:id` | Full detail: owner, current stage, versions, stage history. |
| `PATCH` | `/products/:id` | Update `name`/`description`/`ownerId`/`status`/`expectedCompletionDate`/`actualCompletionDate`. |
| `DELETE` | `/products/:id` | Deletes the product and its versions/stage history. |
| `POST` | `/products/:id/versions` | Create a new `ProductVersion`, bumping `currentVersion`. |
| `POST` | `/products/:id/transition` | Move to the next (`direction: "forward"`, default) or previous (`"backward"`) stage. Can't skip stages; moving backward requires a `reason`. |

## Local setup

Prerequisites: Node.js 22+, Docker (for Postgres).

```bash
npm install

# Copy the env template and adjust DATABASE_URL if not using Docker Compose
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
