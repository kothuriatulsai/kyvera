# 0013 — Project membership and stage-level visibility

## Status

Accepted and implemented, 2026-10-09. Supersedes ADR 0007 point 6 and ADR
0009's "no visibility model like ADR 0004 exists here" framing - both
explicitly left this open ("could be revisited if a real row-level
confidentiality need shows up") rather than closing it off.

## Context

Slice A's authorization has been a plain role gate since ADR 0007: any
authenticated user could read any Project, Tech Pack, or Proto Request. That
was deliberately provisional - the SOP didn't state a confidentiality need
for Slice A, so building a visibility model ahead of a concrete need would
have been exactly the kind of premature generalization this project's
design principles argue against elsewhere. The need is now concrete: Finance
and Merchandiser should only ever see the Proto Requests and approved files
relevant to their own work, Management shouldn't see a Tech Pack still
mid-review, and nobody should see a Project they have nothing to do with at
all.

## Decision

**1. Two layers, enforced in one module (`services/visibility.ts`) every SOP
service goes through** - no inline role/ownership checks scattered through
services, controllers, or routes.

- **Layer A (membership)** decides *which Projects* a role sees at all.
  `ADMIN`, `PMO`, `MANAGEMENT` see every Project unconditionally (see-all
  roles). Every other role (`PRODUCT_DESIGNER`, `ENGINEERING`, `FINANCE`,
  `MERCHANDISER`) needs a `ProjectMember` row for that specific Project.
- **Layer B (stage)** decides *which parts* of an otherwise-visible
  Project's Tech Packs a role sees, and when - see point 4.

**2. Invisible means nonexistent - every failure is a 404, never a 403.**
`visibility.assertProjectVisible` and everything built on it throw
`NotFoundError`, uniformly, whether the underlying id is genuinely
nonexistent or just invisible to this caller - there is deliberately no way
to distinguish the two from the response. This applies to actions as much as
reads: a `PRODUCT_DESIGNER` who isn't a member of a Project gets a 404
trying to create a Tech Pack on it, not a 403 - from where they're standing,
the Project isn't there to act on.

One consequence worth stating plainly: `assertProjectVisible` has its own
explicit existence check (`projectRepository.exists`) that runs *before*
the see-all short-circuit. Without it, a see-all role's check would never
notice a nonexistent `projectId` at all - `canSeeAllProjects` returns before
any lookup - where a non-see-all role's membership lookup gets that
existence check for free (no Project, no membership row either). Found and
fixed while writing this ADR's own test matrix (`projectMembers.test.ts`,
"404s a nonexistent Project even for a see-all actor").

**3. `ProjectMember` (current state) + `ProjectMemberHistory` (append-only
audit trail)**, the same "current-state table paired with a history table"
shape this project's design principles have called for since the very first
handoff document. `onDelete: Restrict` on both, matching the rest of the SOP
domain (ADR 0006 point 9) - this is audit-relevant data, not ephemeral auth
state like `UserSession`'s deliberate `Cascade` exception.

The creating PMO (or ADMIN - `projectRoutes` allows both to create) is
auto-added as a member of their own Project, even though PMO/ADMIN already
see every Project regardless (see-all). This is a roster/audit record, not
a visibility grant - it doesn't change what they can see, it just means
"who's on this Project" has an honest answer for its creator too.

Managing membership (`POST /projects/:id/members`,
`POST /projects/:id/members/:userId/remove`) is PMO/ADMIN-only. Only active
users can be added, and - symmetrically with the auto-add above - a
see-all-role user (`ADMIN`/`PMO`/`MANAGEMENT`) *cannot* be added: they
already see everything, so a membership row for one would be a no-op entry
that only confuses "who is this Project's team" (`addMember`'s explicit
`isMembershipEligibleRole` check, `ValidationError` if violated).

**Migration backfill**: adding this table to a database that already has
Projects with real history needed a one-time backfill, not just the new
tables - otherwise every existing Project would have gone dark to everyone
but ADMIN/PMO/MANAGEMENT the moment the migration ran, including the actual
people who did the work on it. The migration (hand-edited after
`--create-only`, same procedure as every schema change in this project)
adds, for every existing Project: its creator, plus everyone who ever
uploaded a version, left a remark, confirmed, or decided on one of its Tech
Packs. History rows are attributed to the Project's *creator* as `by` -
there was no real "who added whom" event to reconstruct, and the creator is
the closest honest approximation available.

**4. Layer B's stage rules, as implemented in `visibility.ts`:**

| Role | What they see, once the Project is visible |
|---|---|
| `ADMIN`, `PMO` | Everything - all versions, remarks, files, confirmation, approval. |
| `PRODUCT_DESIGNER` | Same as above, for Projects they're a member of. |
| `ENGINEERING` | Same as above, but only once the Tech Pack has at least one version - a zero-version Tech Pack (a rejection's successor, before the designer's next upload) doesn't appear at all. |
| `MANAGEMENT` | Only versions with an Engineering confirmation (+ that version's files and confirmation - and its own `approval`, if any). Unconfirmed versions and **all** remarks are stripped, unconditionally - not just on unconfirmed versions. A Tech Pack with no confirmed version at all doesn't appear. If the real latest version is newer and still unconfirmed, the response adds `hasPendingNewerVersion: true` so the web app can explain why there's nothing to decide, instead of letting Management hit the API's pre-existing "not the latest version" 409. |
| `FINANCE`, `MERCHANDISER` | Never browse Tech Packs directly at all - `GET /tech-packs` is always empty for them, `GET /tech-packs/:id` always 404s, regardless of membership or Tech Pack state. Their only lens into one is the Proto Request it produced: `ProtoRequest.techPackVersion` now carries that version's `attachments` and `approval` directly (previously just an id/versionNumber stub), so the web app never needs to fetch the Tech Pack itself to show them the approved files - it couldn't anyway. |

`ProtoRequest` itself has no stage-level restriction beyond layer A - any
role that's a member of (or sees all of) the Project sees its Proto
Requests. Finance/Merchandiser's restriction is that this is the *only*
thing they get into the Tech Pack domain, not an additional gate on top of
it.

**Attachment downloads are a separate rule from "can browse this Tech
Pack"**, not a reuse of it: Finance/Merchandiser reach a version's files
only if a Proto Request actually pins that *exact* version
(`protoRequestRepository.existsForVersion`) - since that's the only avenue
they have into the Tech Pack domain at all. Management's download rule
mirrors its browsing rule (confirmed versions only). Everyone else follows
the plain membership check.

**5. Write actions check layer A only, via `assertProjectVisible` /
`assertTechPackVisibleById`, not layer B.** Confirming, deciding, uploading,
and remarking are already role-gated at the route level
(`requireRole`), and that role gate already determines who can reach the
action at all - Management is the only role that can ever call `decide`,
and it's see-all, so a layer-B stage check there would never actually fire.
Deciding on an unconfirmed version is already a 409 Conflict from
`techPackDecisionService`'s own pre-existing business-rule check ("not the
latest confirmed version"), which is a *workflow precondition*, not a
visibility question - left as-is rather than reinterpreting it as a 404.
Every write still calls layer A early (before any expensive work - file
saves, opening a transaction), so a non-member `PRODUCT_DESIGNER`/
`ENGINEERING` gets a 404 before anything is written anywhere, same as any
other invisible-resource request.

**6. The member-add picker needed its own, narrowly-scoped endpoint** -
`GET /projects/:id/members/candidates` (PMO/ADMIN only), not a relaxation of
`GET /users` (ADMIN-only since ADR 0011, with no "any authenticated read"
case). PMO manages membership but has no other reason to see the full user
list, and `GET /users` can reveal more than this picker needs to. The
candidates endpoint returns active, non-see-all users who aren't already a
member of that Project - exactly what the "add a member" `<select>` needs,
nothing more.

**7. Web**: `ProjectTeam` (new component) on the Project detail page - the
member list, visible to anyone who can see the Project at all, with an
"Add a member"/"Remove" control shown only to PMO/ADMIN
(`canManageMembers`). The Users page gained a per-row "Projects" toggle
(`UserRow`, lazily fetched) - the same membership, the other direction.
Finance/Merchandiser's Project detail page has no "Tech packs" section at
all (`canSeeTechPacksSection`) - the API already sends them an empty list
either way, but rendering "No tech packs yet." would wrongly imply there
genuinely are none, rather than that this role just can't see them.
`ProtoRequestDetailPage` no longer fetches the Tech Pack separately to get
the approved version's files/approval - it reads them straight off the
`ProtoRequest` response now (point 4) - fetching it the old way would 404
for exactly the roles this page matters most to. `TechPackActions` hides the
decision form and shows "A newer version is under Engineering review."
when `hasPendingNewerVersion` is set (`canDecide` itself now checks it too,
so a stale "Decide" control can't appear even if a caller forgets the UI
check).

## Consequences

- Every SOP service (`projectService`, `techPackService`,
  `techPackReviewService`, `techPackDecisionService`, `protoRequestService`,
  `attachmentService`) now takes the full `Actor` (id + role), not just an
  id - needed for layer A/B decisions. Every controller that previously
  ignored the actor on a read now calls `requireActor(req)` and passes it
  through.
- `TechPackDetail` (shared-types) gains an optional `hasPendingNewerVersion`
  field, present only in Management's shaped response. `ProtoRequest`'s
  `techPackVersion` gains `attachments`/`approval`.
- Substantial, mechanical test fallout: every existing test in
  `projects.test.ts`, `techPacks.test.ts`, `techPackReview.test.ts`,
  `techPackDecision.test.ts` that had a non-see-all role act on a Project
  had no membership link (membership didn't exist yet) - each needed a
  `tests/helpers/membership.ts#addMember` call added. A new
  `tests/visibility.test.ts` holds the matrix below; existing files keep
  their own role-gate (403) tests, since those are unaffected by this ADR.
- Full endpoint x role matrix, one test (or a clearly-identified group) per
  cell that isn't a straightforward "same as the row above":

| Endpoint | ADMIN/PMO | MANAGEMENT | PRODUCT_DESIGNER (member) | ENGINEERING (member) | FINANCE/MERCHANDISER (member) | Any non-see-all, non-member |
|---|---|---|---|---|---|---|
| `GET /projects` | all | all | member-filtered | member-filtered | member-filtered | excluded |
| `GET /projects/:id` | 200 | 200 | 200 | 200 | 200 | 404 |
| `POST /projects` | 201 (role gate) | 403 | 403 | 403 | 403 | 403 |
| `GET /projects/:id/members` | 200 | 200 | 200 | 200 | 200 | 404 |
| `GET .../members/candidates` | 200 | 403 | 403 | 403 | 403 | 403 |
| `POST .../members`, `.../remove` | 201/204 (role gate) | 403 | 403 | 403 | 403 | 403 |
| `GET /tech-packs` (`?projectId=`) | all | confirmed-version TPs only | all | TPs with ≥1 version | **always empty** | empty |
| `GET /tech-packs/:id` | 200, full | 200 shaped, or 404 if no confirmed version | 200, full | 200, full (404 if 0 versions) | **404, always** | 404 |
| `POST /tech-packs`, `.../versions` | 201 (role gate) | 403 | 201 | 403 | 403 | 404 (member role, not a member) |
| `GET .../remarks` | real remarks | **empty**, or 404 if unconfirmed | real remarks | real remarks | **404, always** | 404 |
| `POST .../remarks` | 201 (role gate) | 403 | 201 | 201 | 403 | 404 |
| `POST .../confirm` | 403 (ADR 0009) | 403 | 403 | 201 | 403 | 404 |
| `POST .../decision` | 403 (ADR 0009) | 201 | 403 | 403 | 403 | n/a (see-all role) |
| `GET /proto-requests` (`?projectId=`) | all | all | member-filtered | member-filtered | member-filtered | empty |
| `GET /proto-requests/:id` | 200 | 200 | 200 | 200 | 200 | 404 |
| `GET /attachments/:id/download` | 200 | 200 if confirmed, else 404 | 200 | 200 | 200 only if a Proto Request pins that version, else 404 | 404 |

## Alternatives considered

- **Reuse ADR 0004's assignment/visibility model** (built for the old,
  now-retired module) - rejected: that model's shape (per-stage assignment
  records) doesn't match "member of a Project, full stop" at all; building
  a new, purpose-fit model was simpler than bending an old one.
- **403 instead of 404 for invisible resources** - rejected per point 2:
  confirming that a Project/Tech Pack exists at all, to someone who can't
  see it, is exactly the kind of leak this ADR exists to close. The same
  reasoning ADR 0011 point 7 already applied to the `/users` route.
- **Let Management's "no remarks" rule only apply to unconfirmed versions**
  (i.e. tie it to the same gate as version visibility) - rejected: the plan
  this ADR implements states it as an absolute rule, independent of
  confirmation state, and nothing about Management's job needs review-loop
  chatter even on a version they can otherwise see.
- **Relax `GET /users` to admit PMO**, instead of a dedicated
  `members/candidates` endpoint - rejected: `GET /users` returns more than a
  membership picker needs and ADR 0011 deliberately kept it admin-only with
  no exceptions; a narrow, purpose-built endpoint was less invasive than
  reopening that decision for a need that's really just "list candidates
  for this one picker."
