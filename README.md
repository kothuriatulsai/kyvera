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
The verified caller is `req.actor` (id and role), and what they may see and do is
decided per product - see [Access control](#access-control) below.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/register` | `{ name, email, password }` (password 8–128 chars). Creates a user with the least-privileged role (`ENGINEER`); sending a `role` is a `400`. |
| `POST` | `/auth/login` | `{ email, password }` → `{ token, tokenType, expiresIn, user }`. Wrong password and unknown email return the same `401`. |
| `GET` | `/auth/me` | The caller's own user record; needs a token. |

Passwords are hashed with argon2id. Tokens are HS256 JWTs whose claims are only
the user id (`sub`) and `role`, and they live for one hour
(`JWT_EXPIRES_IN_SECONDS`). There is no refresh flow: when a token expires the
client logs in again. The token only proves *who* is calling: on every request
the user is loaded and their *current* role used, so a demoted or deleted user
loses access immediately rather than when their token expires. Configure
`JWT_SECRET` (required, 32+ characters) as described in `apps/api/.env.example`.

`db:seed` gives the seeded users a real hash of a well-known dev password
(`kyvera-dev-password`, or `SEED_USER_PASSWORD`) so you can log in as, for
example, `admin@kyvera.dev`. It is dev data; never seed a shared environment.

### Endpoints

What each product endpoint returns depends on who is asking: see
[Access control](#access-control).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/products` | The products the caller can see, each shaped for their access, with live-computed `status` and a `delay` summary (see below). |
| `POST` | `/products` | Create a product. Also creates its v1 `ProductVersion` and opens the first `ProductStageHistory` entry. Open to any authenticated user (who may create, and `ownerId`, are not settled by the ADRs). |
| `GET` | `/products/:id` | Detail: for admin/owner/assigned manager, owner, current stage, versions, stage history, approvals, assignments and progress notes; for an assignee, only their own stages. |
| `GET` | `/products/:id/delay` | Live per-stage delay breakdown plus the projected `expectedCompletionDate` (assignees get only their own stages). |
| `PATCH` | `/products/:id` | Update `name`/`description`/`ownerId`/`status`/`expectedCompletionDate`/`actualCompletionDate`. Needs authority over the product, and changing `ownerId` is admin-only. `status` is derived from delay, so only `BLOCKED` can be set manually; `DELAYED` is rejected with a `400`, and `ON_TRACK` is accepted only to clear a `BLOCKED` product (the stored value is then re-derived). |
| `DELETE` | `/products/:id` | Deletes the product and its versions/stage history. |
| `POST` | `/products/:id/versions` | Create a new `ProductVersion`, bumping `currentVersion`. |
| `POST` | `/products/:id/transition` | Move to the next (`direction: "forward"`, default) or previous (`"backward"`) stage. Can't skip stages; moving backward requires a `reason`. Moving into the final (Approval) stage requires an `approval` decision (see below). `force: true` advances a multi-assignee stage without everyone's sign-off. Who may do which is in [Access control](#access-control). Recomputes and persists `expectedCompletionDate`/`status`. |
| `POST` | `/products/:id/assignments` | Admin only. `{ stageId, userId }` assigns a user to a stage of the product. |
| `DELETE` | `/products/:id/assignments/:assignmentId` | Admin only. Removes an assignment (and, if it was their only one, the user's access to the product). |
| `POST` | `/products/:id/assignments/:assignmentId/ready` | An assignee marks *their own* assignment ready; only the current stage can be marked. Never moves the product. |
| `POST` | `/products/:id/stages/:stageId/notes` | `{ note }`: an assignee adds a progress/delay note to a stage they are assigned to, at any time. Never moves the product. |

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
| `GET` | `/stages` | The stage definitions the caller may know: all of them for an admin or anyone who sees a product in full, otherwise only the stages they are assigned to. |

### Approvals

Entering the final stage is an approval gate. The transition request must
carry `approval: { decision: "APPROVED" | "REJECTED", notes? }`:

- `APPROVED` moves the product into the Approval stage.
- `REJECTED` (with `notes`) instead sends it one stage back, through the normal
  backward path, with the notes as the reason.
- Either way an append-only `approvals` row is written in the same transaction,
  pinned to the product's current `ProductVersion` - this is what Module 2 will
  check before a product can be manufactured.
- The decision is attributed to the authenticated user; a `decidedById` in the
  body is a `400`. Only an admin, the product's owner, or a manager assigned to
  it may decide (see below). See `docs/architecture/0005-approval-records.md`.

### Access control

Implements `docs/architecture/0004-stage-level-access-control.md`. Who someone is
*to a product* is decided per product, not from their role alone, in one place
(`services/accessService.ts`):

| Level | Who | Sees | Holds authority |
|---|---|---|---|
| `ADMIN` | a user with role `ADMIN` | every product, in full | over all of them |
| `OWNER` | the product's owner, whatever their role | their own product, in full | over it |
| `MANAGER` | a `MANAGER` assigned to a stage of it | that product, in full | over it |
| `ASSIGNEE` | anyone else assigned to a stage of it | only their own stages, plus a readiness hint | no |
| (none) | everyone else, including managers with no assignment | nothing: not listed, and a `404` if requested | no |

"Authority" means: move the product backward, force or trigger a multi-assignee
transition, decide an approval, and edit, delete or version it. Changing a
product's owner and managing assignments are admin-only.

- **Assignee view.** `view: "assignee"` responses contain only the caller's own
  stages, each with a readiness hint (`completed` / `open_now` / `up_next` /
  `upcoming`, plus `opensInDays`), their own ready mark, that stage's delay
  figures, history and notes. No other stage's name, status or history, and none
  of the product's status, dates, owner, versions or approvals. Full views carry
  `view: "full"`.
- **Sign-off.** On a stage with several assignees each marks themselves ready.
  Nothing fires when the last one does: an admin, the owner or an assigned manager
  triggers the transition, or forces it (`force: true`, recorded as `forcedExit`)
  without everyone's sign-off. A stage with one assignee can be advanced by that
  assignee directly. Every transition records who triggered it (`exited_by`).
  Marks on a stage reset when the product re-enters it.
- **Errors.** `401` not logged in; `404` no relationship to the product (same as if
  it didn't exist); `403` you can see it but lack authority; `409` a
  multi-assignee stage that is not fully signed off and was not forced.

Not settled by the ADRs and therefore unchanged: who may create a product and
`ownerId` on creation, `responsibleUserId` on a transition and `createdById` on a
new version.

## Frontend (Module 1)

`apps/web` is a React + Vite app (React Router) over the API above, using response
types from `packages/shared-types`. Set `VITE_API_URL` to point it at the API
(defaults to `http://localhost:4000`).

**Logging in.** Every route except `/login` needs a logged-in user; anyone else is
redirected to the login page and, after logging in, taken back to where they were
headed. Seeded dev users (`admin@`, `owner@`, `engineer@`, `finance@kyvera.dev`, password
`kyvera-dev-password`) can log in; see the Authentication section above.

**Where the token lives: in memory only.** The access token is held in a module-level
variable owned by `AuthProvider` - never `localStorage`, `sessionStorage` or a cookie,
because anything a script can read from storage, an injected script can read too. The
trade-off is deliberate and explicit: **a hard refresh logs you out**. There is no
refresh-token flow yet (access tokens last an hour), so there is nothing to
silently restore a session from. Logging out just drops the token; the API is stateless,
so there is no server-side revocation, and a token copied elsewhere stays valid until
it expires. An expired or invalid token (a `401`) sends you to the login page with an
explanation rather than a broken page.

**Two views of a product** (see [Access control](#access-control)), chosen by the
`view` field the API returns:

| `view` | Who | What is shown |
|---|---|---|
| `full` | admin, owner, assigned manager | The list, delayed and detail pages: stage timeline with per-stage delay, assignments, progress notes, stage history, versions. |
| `assignee` | anyone else assigned to a stage | "Assigned to you": only their own stage(s) with a readiness hint ("Open now", "You're up next: opens in ~5 days"). The detail page adds their ready mark, history, notes, and actions to mark their part ready, add a note, and complete the stage. |

The assignee pages render only what the API sent and request nothing else: no
`/stages`, no `/delay`, no other stage's name. The API does not say how many people
share a stage, so "Complete this stage" is offered whenever the stage is open and the
server's own reason is shown if it refuses.

**CORS.** The API only accepts browser requests from an explicit allowlist
(`CORS_ALLOWED_ORIGINS`, default `http://localhost:5173`, never a wildcard). If Vite
starts on another port, add that origin or the browser will block every request; the
login page then says the API could not be reached and names CORS, rather than
reporting a bad password.

| Route | View |
|---|---|
| `/login` | Log in. |
| `/` | Product list: full products (stage, owner, live status, projected completion), then "Assigned to you". |
| `/delayed` | Products that are currently delayed, worst first, then "Your stages running late". |
| `/products/:id` | Detail, in the full or assignee shape. |

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
