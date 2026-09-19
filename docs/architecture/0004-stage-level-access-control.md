# 0004 — Stage-level access control

## Status

Accepted — 2026-09-20. Proposed 2026-09-19; its five open questions and the
four follow-up points they raised are all resolved below (see "Resolution
notes"). Implementation is not started: the hand-rolled JWT auth it depends on
is the next piece of work.

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
- An **admin** can see every stage, every status and every user, and only an
  admin can create or change users and their assignments. (A product's owner
  also sees their own product in full — see Resolution 4.)
- An assignee still needs to plan ("when do I need to have my stuff ready?")
  without being shown the rest of the workflow. See Resolution 1.

## Decision

Split "who a user is" from "what they may touch":

1. **Global role** (`users.role`) gates which *kinds of actions and modules* a
   user can use (for example `FINANCE` will matter for Module 3's budget
   endpoints). `ADMIN` can read everything and is the only role that manages
   users and assignments. `MANAGER`, `ENGINEER` and `FINANCE` grant **no extra
   visibility into any product's stage data**.
2. **Stage assignments** are data, in a new join table
   `product_stage_assignments` (`product_id`, `stage_id`, `user_id`,
   `assigned_at`, `assigned_by`, and a nullable `ready_at` timestamp), unique
   on the (product, stage, user) triple. Nothing is hardcoded per role: which
   stages a person works is a per-product decision the admin makes,
   consistent with stages-as-data (ADR 0003). Assignment — not role —
   is what gates visibility into a specific product's stage data.
3. **Enforcement lives in the service layer, not the UI.** Services take the
   authenticated actor and return a *viewer-specific projection*:
   - an **assignee** sees only the products they're assigned to, and within
     them only their own assigned stages, plus a **readiness hint** derived
     server-side from stage history (states such as "up next", "your stage
     opens in ~N days", "open now", "completed"). No other stage names or
     statuses are exposed.
   - a product's **owner** sees that whole product, regardless of assignment,
     and only products they own.
   - an **admin** sees everything.

   Hiding things in React alone would leak through the API.
4. **Progress and transition are two separate actions.**
   - *Recording progress* — a delay reason or status note on a stage, stored
     as a row in the dedicated `stage_progress_notes` table (`id`,
     `product_id`, `stage_id`, `user_id`, `note`, `created_at`) — is available
     to any assignee of that stage, at any time, and does **not** move the
     product.
   - *Advancing the product* is a separate, guarded action. For a stage with
     one assignee, that assignee completing it can trigger the forward
     transition. For a stage with several assignees, each marks themselves
     ready (`ready_at`). Once every assignee is ready the transition becomes
     available but is **not** fired automatically: someone with authority over
     the product (below) must trigger it. Those same people can **force** the
     transition without every sign-off.
   - **Backward moves** are limited to those with authority over the product.
     Assignment changes and user management are admin-only.
   - **Authority over a product** is a scoped set, not a global role: an
     **admin** (unscoped, all products), the product's **owner** (a local admin
     for that product, Resolution 4), or a **manager who is assigned to** the
     product. It is the same boundary as visibility, so there is no second
     access model alongside it. Forcing a transition, moving backward,
     triggering a fully-signed-off multi-assignee transition, and deciding an
     approval (ADR 0005) all use this one set.
5. **Changes are audited** in a paired history table
   (`product_stage_assignment_history`), following the project rule that every
   entity with meaningful state changes gets an audit trail from day one.
   Assignment changes are recorded there; readiness marks are timestamped on
   the assignment row itself.

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

### Resolution notes

The five questions raised when this ADR was proposed, and how each was
settled:

1. **What an assignee sees of the rest of the product — only their own
   stages, plus a derived hint.** The real need is timing ("when should I have
   my part ready?"), not knowledge of the workflow. So the server computes a
   readiness hint from stage history and returns just that; stage names and
   statuses outside the assignee's own stages never leave the API. The
   trade-off accepted here is that the hint necessarily reveals *aggregate*
   lead time (how long until the stage opens), which is judged acceptable and
   far less than exposing the current stage's name.
2. **Progress and transition are different things.** Writing "we're running
   late because the supplier slipped" is information about a stage and is safe
   for any assignee to add whenever they need to, without any effect on the
   product. Moving the product is a workflow event with consequences for
   everyone downstream, so it stays guarded: the sole assignee of a stage can
   finish it, several assignees must each mark themselves ready, and someone
   with authority over the product can override when an assignee is
   unavailable rather than letting the product stall. Going backward is
   rework and is kept with that same group, matching how approval decisions
   are gated.
3. **Role decides what kinds of things you can do; assignment decides what
   you can see.** Keeping the two apart means "manager" doesn't quietly become
   a second admin for data, and `FINANCE` can gain budget endpoints in Module 3
   without also gaining a view into every product's stages. Role alone grants
   no extra product visibility.
4. **The owner sees their own product in full — and only their own.**
   Ownership is a responsibility for the whole product, so requiring an
   assignment on every stage to see it would be odd. It is deliberately not a
   general grant: it is scoped to products a user owns, making them
   effectively a local admin for that product. (The per-product-membership model
   rejected below for assignees is adopted, narrowly, for owners only.)
5. **Outside contributors are ordinary users.** No separate account type: a
   contributor is a normal `users` row with no assignments until an admin adds
   some, which already gives them exactly the access described above. An
   invitation flow or account-type distinction is deferred until a concrete need
   for different behavior appears.

#### Follow-up resolutions

Accepting the ADR left four points that followed from the decisions above but
hadn't been specified. They are settled here so implementation doesn't have to
assume them:

6. **Manager authority is scoped to visibility, not global.** A manager can
   force a multi-assignee transition or move a product backward only on
   products they own or are assigned to — the same boundary as everything else
   in this ADR. Only an admin has unscoped authority. The alternative was to
   give managers special blind authority over products they can't see, but that
   would create a second access model alongside the visibility one, with its
   own rules to keep in sync; scoping authority to visibility keeps a single
   model.
7. **The owner's local-admin status extends to approval decisions on their own
   product.** The owner counts alongside admin and manager for ADR 0005's
   approval gate, so that gate reads "admin, the product's owner, or an
   assigned manager." The trade-off accepted is that an owner can approve their
   own product; that was preferred over making ownership a weaker kind of
   admin, given that "local admin for their own product" is exactly what
   Resolution 4 says an owner is.
8. **A fully signed-off multi-assignee transition still needs a manual
   trigger.** Once every assignee's `ready_at` is set the transition is
   available, but it is fired by someone with authority over the product (per
   Resolutions 6 and 7), not automatically on the last sign-off. Auto-firing
   would record whichever assignee happened to go last as the cause of the
   transition, when in fact nobody decided to advance the product — the
   audit trail would say something untrue. A person pressing the button is a
   real decision and gets attributed as one.
9. **Progress notes get their own table, `stage_progress_notes`** (`id`,
   `product_id`, `stage_id`, `user_id`, `note`, `created_at`). It does not reuse
   the `comments` table whose deferral ADR 0005 records: a progress note is
   scoped, functional data — it is read by the readiness and delay views and
   is visible only to the people the projection allows — whereas `comments`
   would be free-form discussion. So this does not reopen that deferral. It is
   also distinct from `ProductStageHistory.delay_reason`, which stays the reason
   captured when a stage closes on a transition; progress notes are the ongoing
   record while a stage is open.

## Consequences

- Every service function that reads or writes product data gains an `actor`
  parameter; the controllers derive it from the verified JWT. This is a broad
  but mechanical change, which is why doing it before Module 2 is cheaper.
- Response shapes now depend on the viewer, so `packages/shared-types` needs
  to represent partial views (assignee projection with the readiness hint vs.
  owner/admin full view), and API tests need per-role cases: "assignee cannot
  see a stage they aren't on" is a test to write first.
- Delay computation is unaffected — it stays derived from stage history
  (ADR 0003). Assignees don't overwrite the computed delay; they annotate it
  (a reason, a progress update). But the computation must run over the *full*
  history and only the *output* gets filtered — including the readiness hint,
  which needs the durations of stages the assignee otherwise can't see —
  otherwise an assignee's view would compute wrong dates.
- The transition endpoint gains actor-dependent rules (who may advance, force,
  trigger a signed-off multi-assignee stage, or go backward), all keyed to the
  same authority set. The approval gate from ADR 0005 uses that set too: today
  it is coarser (any `ADMIN`/`MANAGER` user, checked against a user named in the
  request body), and it tightens to "admin, the product's owner, or an assigned
  manager" once the verified actor and ownership/assignment data exist.
- Because an owner has authority over their own product, they can approve it
  (Resolution 7). There is no separation of duties between owning and approving
  a product; this is a conscious trade-off, not an oversight.
- A new table, `stage_progress_notes`, and a `ready_at` column on assignments
  are part of the schema this work adds, alongside `product_stage_assignments`
  and its history table.
- The frontend's list and delayed views, which currently assume everyone sees
  everything, will need to respect the projection (the "delayed" view for an
  assignee is only their stages).
- Role and assignment are two separate checks on every path, plus more tables
  and joins — accepted as the price of the confidentiality requirement.

## Alternatives considered

- **Role-only permissions** (engineer sees engineering stages, etc.) — simple,
  but roles are per person, not per stage per product. It can't express "this
  user supports the Solar Charger's Prototype stage only", and it forces a
  stage → role mapping into code, undoing ADR 0003. Rejected.
- **Per-product membership only** (assigned to a product = sees the whole
  product) — much simpler, but fails the confidentiality requirement: seeing
  the full timeline is exactly what should be withheld. Rejected for
  assignees; adopted only for a product's owner (Resolution 4).
- **Also showing assignees the product's current stage name** — would make
  planning easier, but exposes exactly the kind of workflow information the
  confidentiality requirement is about. Rejected in favor of the derived
  readiness hint.
- **Progress = transition** (completing your stage always moves the product,
  no separate notes action) — simpler, but conflates recording information
  with a workflow event and gives no way to flag a delay without advancing.
  Rejected in favor of two separate actions.
- **Global (blind) manager authority** — letting any manager force or reverse
  a transition on any product — is simpler to state, but means managers act on
  products they can't see and a second access model exists beside visibility.
  Rejected in favor of scoping authority to visibility (Resolution 6).
- **Auto-firing a multi-assignee transition on the last `ready_at`** — removes a
  manual step, but attributes the transition to whichever assignee signed off
  last when nobody chose to advance the product, corrupting the audit trail.
  Rejected (Resolution 8).
- **Reusing the deferred `comments` table for progress notes** — avoids a new
  table, but mixes scoped, functional data with free-form discussion and would
  force `comments` to carry projection rules it otherwise wouldn't need.
  Rejected (Resolution 9).
- **A separate external-contributor account type with an invitation flow** —
  premature: an ordinary user with no assignments already behaves correctly.
  Deferred until a real need for different behavior shows up.
- **Hide data in the frontend only** — trivially bypassed by calling the API
  directly. Rejected.
- **A third-party authorization service (Clerk/Auth0/policy engine)** —
  outsources the very thing this project is meant to build, per the
  hand-rolled auth decision. Rejected for now.
