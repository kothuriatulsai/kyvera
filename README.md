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

**Module 1 — Product Development** is the current focus. It implements
NiTISI's real SOP for developing a product: a Project moves through phases
(Proto, then Bulk), each phase's Tech Pack goes through Engineering review
and Management approval before a Proto Request is raised, with every
rejection creating a new Tech Pack revision rather than editing history in
place (see `docs/architecture/0006` onward). An earlier, generic 9-stage
version of this module was built first and fully removed once this SOP-based
version proved out end to end — see `docs/architecture/0010`.

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
| Auth | Hand-rolled JWT + role-based access (ADMIN, PMO, PRODUCT_DESIGNER, ENGINEERING, MANAGEMENT, FINANCE, MERCHANDISER) |
| Testing | Vitest + Supertest |
| Deployment | Docker Compose locally; Railway/Render for a live demo |
| CI | GitHub Actions — lint + typecheck + test on every PR |

See `docs/architecture/` for the reasoning behind these decisions and
`docs/journal/` for a running build log.

## API (Module 1)

### Authentication

Every endpoint except `/health` and `POST /auth/login` requires
`Authorization: Bearer <token>` and returns `401` without a valid one. The
verified caller is `req.actor` (id and role). There is no self-registration
endpoint: accounts come only from the seed for now (ADR 0010); an admin
"create user" feature is future work.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` | `{ email, password }` → `{ token, tokenType, expiresIn, user }`. Wrong password and unknown email return the same `401`. |
| `GET` | `/auth/me` | The caller's own user record; needs a token. |

Passwords are hashed with argon2id. Tokens are HS256 JWTs whose claims are only
the user id (`sub`) and `role`, and they live for one hour
(`JWT_EXPIRES_IN_SECONDS`). There is no refresh flow: when a token expires the
client logs in again. The token only proves *who* is calling: on every request
the user is loaded and their *current* role used, so a demoted or deleted user
loses access immediately rather than when their token expires. Configure
`JWT_SECRET` (required, 32+ characters) as described in `apps/api/.env.example`.

`db:seed` creates exactly one user per role, with a real hash of a well-known
dev password (`kyvera-dev-password`, or `SEED_USER_PASSWORD`) so you can log
in as, for example, `admin@kyvera.dev`: `admin@`, `pmo@`, `designer@`,
`engineering@`, `management@`, `finance@`, `merchandiser@kyvera.dev`. It is
dev data; never seed a shared environment.

### Access control

Authorization is a plain role gate (`requireRole` middleware) checked against
the caller's current role - not per-row assignment or ownership. Reads are
open to any authenticated user for every endpoint below; writes are gated per
role as shown. `ADMIN` can do everything PMO/PRODUCT_DESIGNER can, but **not**
what's marked Engineering/Management-only - ADR 0009 deliberately excludes
`ADMIN` from the Tech Pack confirm/approve gates, so that sign-off always
reflects a real Engineering or Management decision. See
`docs/architecture/0007`–`0009`.

### Projects (Stage 1)

| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/projects` | any authenticated user | List, newest first. |
| `GET` | `/projects/:id` | any authenticated user | Detail. |
| `POST` | `/projects` | PMO, ADMIN | `{ name, productName, productCategory? }`. `code` (`PRJ-000001`, ...) is assigned by the database, not the caller. |

### Tech Packs + versions (Stage 2)

| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/tech-packs` | any authenticated user | List, narrower shape than the detail. |
| `GET` | `/tech-packs/:id` | any authenticated user | Detail: all versions, newest first, each with its attachments, remarks, confirmation and approval. |
| `POST` | `/tech-packs` | PRODUCT_DESIGNER, ADMIN | Multipart: project id, notes, files. At most one non-voided Tech Pack per Project per phase (enforced server-side, not just in the UI). |
| `POST` | `/tech-packs/:id/versions` | PRODUCT_DESIGNER, ADMIN | Multipart: a new revision. Rejected once the Tech Pack is voided or already has an approved version. |

Uploads are size- and extension-limited (`MAX_ATTACHMENT_SIZE_BYTES`,
`ALLOWED_ATTACHMENT_EXTENSIONS` in `packages/shared-types`, enforced on both
the API and the web upload form). Files are never served statically - the
one way to read the bytes is:

| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/attachments/:id/download` | any authenticated user | Sets `Content-Disposition`. |

### Engineering review and Management decision (Stage 3)

| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/tech-packs/:id/versions/:versionNumber/remarks` | any authenticated user | The review thread on one version, oldest first. |
| `POST` | `/tech-packs/:id/versions/:versionNumber/remarks` | ENGINEERING, PRODUCT_DESIGNER, ADMIN | `{ body }`. Allowed on any version up until the Tech Pack is voided. |
| `POST` | `/tech-packs/:id/versions/:versionNumber/confirm` | **ENGINEERING only** | Signs off the *latest* version, once. No ADMIN carve-out (ADR 0009). |
| `POST` | `/tech-packs/:id/versions/:versionNumber/decision` | **MANAGEMENT only** | `{ decision: "APPROVED" \| "REJECTED", notes? }`. Only on a confirmed, latest version. No ADMIN carve-out (ADR 0009). `APPROVED` creates a Proto Request; `REJECTED` voids the Tech Pack and opens a new one (zero versions yet) under the same Project, linked via `supersedesId`. |

### Proto Requests (Stage 3's output)

| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/proto-requests` | any authenticated user | List, newest first. Supports `?projectId=` to filter to one Project. |
| `GET` | `/proto-requests/:id` | any authenticated user | Detail: project, Tech Pack + pinned version, the approved version's files, who approved it and when. |

There is no direct write endpoint - a Proto Request is only ever created as a
side effect of an `APPROVED` decision above.

## Frontend (Module 1)

`apps/web` is a React + Vite app (React Router) over the API above, using response
types from `packages/shared-types`. Set `VITE_API_URL` to point it at the API
(defaults to `http://localhost:4000`).

**Logging in.** Every route except `/login` needs a logged-in user; anyone else is
redirected to the login page and, after logging in, taken back to where they were
headed. Seeded dev users (see the Authentication section above) can log in.

**Where the token lives: in memory only.** The access token is held in a module-level
variable owned by `AuthProvider` - never `localStorage`, `sessionStorage` or a cookie,
because anything a script can read from storage, an injected script can read too. The
trade-off is deliberate and explicit: **a hard refresh logs you out**. There is no
refresh-token flow yet (access tokens last an hour), so there is nothing to
silently restore a session from. Logging out just drops the token; the API is stateless,
so there is no server-side revocation, and a token copied elsewhere stays valid until
it expires. An expired or invalid token (a `401`) sends you to the login page with an
explanation rather than a broken page.

**Role/state gating lives in one module** (`lib/sopPermissions.ts`:
`canCreateProject`, `canCreateTechPack`, `canUploadVersion`, `canRemark`,
`canConfirm`, `canDecide`), mirroring the API's own role gates above exactly.
Components only call these; the server enforces every action regardless, so
this is about what to *show*, not security.

**CORS.** The API only accepts browser requests from an explicit allowlist
(`CORS_ALLOWED_ORIGINS`, default `http://localhost:5173`, never a wildcard). If Vite
starts on another port, add that origin or the browser will block every request; the
login page then says the API could not be reached and names CORS, rather than
reporting a bad password.

| Route | View |
|---|---|
| `/login` | Log in. |
| `/` and `/projects` | Project list, with a form to create one (PMO/ADMIN). |
| `/projects/:id` | Project detail: its Tech Packs (with the voided/superseded chain) and Proto Requests, a form to create a Tech Pack (PRODUCT_DESIGNER/ADMIN). |
| `/tech-packs/:id` | Tech Pack detail: every version's attachments, remark thread, confirmation and approval, with the upload/remark/confirm/decide actions each role can take. |
| `/proto-requests` | Proto Request list. |
| `/proto-requests/:id` | Proto Request detail. |

## Local setup

Prerequisites: Node.js 22+, Docker (for Postgres).

```bash
npm install

# Copy the env template, adjust DATABASE_URL if not using Docker Compose, and
# set JWT_SECRET (the file explains how to generate one)
cp apps/api/.env.example apps/api/.env

# Start Postgres
docker compose up -d postgres

# Apply migrations and seed one user per role
npm run db:migrate --workspace apps/api
npm run db:seed --workspace apps/api

# Run the apps
npm run dev --workspace apps/api
npm run dev --workspace apps/web
```

`docker compose up` also builds and runs `api`/`web` themselves, if you'd
rather run everything in containers.

**Editing `packages/shared-types`?** `apps/api` and `apps/web` both resolve it
through its compiled `dist/` output (its `package.json` `main`/`types`), not
its TypeScript source directly - a plain `tsc` build, not Vite/tsx/vitest's
on-the-fly transform, since the compiled API is run with plain `node`, which
refuses to transform a `.ts` file found under `node_modules`. A change to
`packages/shared-types/src` is invisible to the other two until it's rebuilt:

```bash
# One-off, after an edit
npm run build --workspace packages/shared-types

# Or leave this running in its own terminal instead, alongside the two `dev`
# commands above, to rebuild on every save
npm run dev --workspace packages/shared-types
```

### Quality checks

```bash
npm run lint
npm run typecheck
npm run test
```

These also run in CI on every pull request.

**`npm run test` uses its own database** (`kyvera_test` by default, same
Postgres server as `DATABASE_URL`, overridable via `TEST_DATABASE_URL`) and
its own uploads directory (a temp directory, not `apps/api/uploads/`) -
entirely separate from dev data. A one-time global setup creates that
database if it doesn't exist, applies migrations to it, and truncates every
table before each run, so every test run starts from the same clean state and
dev data is never read or written. It refuses to run at all if
`TEST_DATABASE_URL` doesn't point at a database whose name ends in `_test`,
so a misconfigured env can't truncate the wrong database. No separate setup
step is needed beyond having Postgres reachable - `npm run test` provisions
the test database itself.
