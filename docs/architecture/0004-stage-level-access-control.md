# 0004 — Stage-level access control

## Status

Proposed — captured 2026-09-19, not yet scheduled. To be accepted (and its
open questions resolved) when the auth/access-control work starts.

## Context

Module 1 currently has no notion of who is acting. `ownerId` and
`responsibleUserId` are plain request fields, so anyone can act as anyone, and
every endpoint returns everything. The `users.role` column
(admin / manager / engineer / finance) exists but nothing enforces it.

In practice a product's workflow is not handled by one person. Different
people work different stages: one person might do Initial Design *and*
Engineering, Review belongs to someone else, the Prototype to someone else
again. The whole workflow could be one person, a stage could have several
people, and one person could work several stages. Some of these people are
outside contributors who support us on specific products, and for
confidentiality they should only see the part of the workflow they touch.

Requirements as stated:

- Users are assigned to **specific stages of specific products**. The
  assignment relation is many-to-many in every direction (user ↔ stage ↔
  product).
- An assignee sees only the products and stages they are assigned to. They can
  update the delay/progress of *their* stages and nothing else.
- Only an **admin** can see every stage, every status and every user, and
  only an admin can create or change users and their assignments.
- An assignee still needs to plan ("when do I need to have my stuff ready?").
  See open question 1.

## Decision

Split "who a user is" from "what they may touch":

1. **Global role** (`users.role`) stays as the coarse capability level.
   `ADMIN` is the only role that can read everything and manage users and
   assignments.
2. **Stage assignments** are data, in a new join table
   `product_stage_assignments` (`product_id`, `stage_id`, `user_id`,
   `assigned_at`, `assigned_by`), unique on the triple. Nothing is
   hardcoded per role: which stages a person works is a per-product decision
   the admin makes, consistent with stages-as-data (ADR 0003).
3. **Enforcement lives in the service layer, not the UI.** Services take the
   authenticated actor and return a *viewer-specific projection*: an
   assignee's `GET /products/:id`, `/delay` and stage history contain only
   their assigned stages; list endpoints only return products they're
   assigned to. Hiding things in React alone would leak through the API.
4. **Writes are scoped the same way.** An assignee may record progress and
   delay information (e.g. `delayReason`) only on a stage they're assigned to
   *and* that the product is currently in. Assignment changes and user
   management are admin-only.
5. **Assignment changes are audited** in a paired history table
   (`product_stage_assignment_history`), following the project rule that every
   entity with meaningful state changes gets an audit trail from day one.

### Where it belongs in the roadmap

This is a **cross-cutting access-control module, built after Module 1 is
functionally complete and before Module 2 (Manufacturing/Orders)** — together
with the hand-rolled JWT auth that is already planned. Reasons:

- It cannot exist without authenticated identity: a stage assignment is
  meaningless if the caller can claim to be anyone. JWT auth is the
  prerequisite, and the two should be designed together.
- Every later module (orders, budgets, suppliers) needs the same "who is
  asking, what may they see" question. Building it before Module 2 means
  orders are written against the actor-aware service pattern from the start.
  Retrofitting per-viewer filtering into finished services and routes is
  exactly the painful late change the project's design principles try to
  avoid.
- It should *not* go earlier, into Module 1's CRUD/timeline work: Module 1's
  value is the workflow and delay logic, and access rules would have been
  designed without a real identity to test against.

## Consequences

- Every service function that reads or writes product data gains an `actor`
  parameter; the controllers derive it from the verified JWT. This is a broad
  but mechanical change, which is why doing it before Module 2 is cheaper.
- Response shapes now depend on the viewer, so `packages/shared-types` needs
  to represent partial views (assignee projection vs. admin view), and API
  tests need per-role cases: "assignee cannot see stage they aren't on" is a
  test to write first.
- Delay computation is unaffected — it stays derived from stage history
  (ADR 0003). Assignees don't overwrite the computed delay; they annotate it
  (a reason, a progress update). But the computation must run over the *full*
  history and only the *output* gets filtered, otherwise an assignee's view
  would compute a wrong projected completion date.
- The frontend's current N+1 `/delay` calls and role-blind pages will need to
  respect the projection (the "delayed" view for an assignee is only their
  stages).
- More tables and joins, and a permission check on every path — accepted as
  the price of the confidentiality requirement.

## Open questions

Resolve these before accepting the ADR:

1. **How much may an assignee see about the rest of the product?** They need
   to know when to prepare, but must not see other stages. Options: (a) only
   their own stages, with a derived readiness hint like "your stage is next" /
   "starts in ~N days" that reveals no stage names; (b) also the product's
   *current stage name*. (a) is the safer default and needs no extra
   exposure.
2. **What is "progress" for an assignee?** Today a transition is product-wide
   (`forward`/`backward`). Should completing your stage move the product
   forward — and if a stage has several assignees, must one, or all of them,
   sign off? Should backward moves stay admin-only?
3. **What do `MANAGER`, `ENGINEER` and `FINANCE` mean now?** The stated rule is
   that only the admin sees everything, so a manager has no extra reach by
   role alone. Are they just labels for job function (finance needing
   budget access in a later module), or should any of them get broader
   visibility?
4. **Product `owner`.** Does the owner keep visibility over their whole
   product even when not assigned to every stage, or is ownership just
   another assignment?
5. **Outside contributors.** Do external supporters need a separate account
   type (invitation flow, no access beyond assignments), or are they ordinary
   users with no assignments until an admin adds some?

## Alternatives considered

- **Role-only permissions** (engineer sees engineering stages, etc.) — simple,
  but roles are per person, not per stage per product. It can't express "this
  user supports the Solar Charger's Prototype stage only", and it forces a
  stage → role mapping into code, undoing ADR 0003. Rejected.
- **Per-product membership only** (assigned to a product = sees the whole
  product) — much simpler, but fails the confidentiality requirement: seeing
  the full timeline is exactly what should be withheld. Rejected as the
  primary model, though it is a possible fallback for the product `owner`
  (question 4).
- **Hide data in the frontend only** — trivially bypassed by calling the API
  directly. Rejected.
- **A third-party authorization service (Clerk/Auth0/policy engine)** —
  outsources the very thing this project is meant to build, per the
  hand-rolled auth decision. Rejected for now.
