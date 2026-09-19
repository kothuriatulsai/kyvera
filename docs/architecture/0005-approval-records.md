# 0005 — Approval records

## Status

Accepted

## Context

The original brief defines the handoff from Module 1 to Module 2 in one
sentence: when a product is approved in Product Development, it becomes
available for manufacturing. Manufacturing orders (Module 2) are meant to pin
to a specific `ProductVersion` (see `docs/architecture/0002` and the
`ProductVersion` comment in `schema.prisma`), so "approved" has to be a fact
about a *particular version*, not just about a product.

Today nothing in the schema records an approval decision. The workflow has a
stage named "Approval" (`sequence_order` 9, the last one seeded), but reaching
it is only a stage transition — there is no record of *who* decided, *what*
they decided, *when*, or *about which version*. There is also no rejection
path other than a backward transition with a free-text `reason`, which is
indistinguishable in the data from any other rework.

If Module 2 started without fixing this, creating a manufacturing order would
have to infer "approved" from "the product reached the last stage." That loses
the decision record, can't represent a rejection, and can't answer "was *this
version* approved?" — a structural gap that would be expensive to retrofit
once orders reference products. This is the kind of late gap the project's
design principles (audit trails and version pinning from day one) exist to
prevent.

## Decision

Add an `approvals` table and make approval a first-class step of the
stage-transition flow.

**Schema.** `approvals` (`Approval` in `schema.prisma`):

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `product_id` | FK → `products` |
| `product_version_id` | FK → `product_versions` — the exact version being decided on |
| `stage_id` | FK → `stage_definitions` — always the Approval stage |
| `decision` | enum `APPROVED` \| `REJECTED` |
| `decided_by` | FK → `users` |
| `decided_at` | timestamp, defaults to now |
| `notes` | optional free text (required when `REJECTED`, see below) |

Approval records are append-only: there is no update or delete path. A
rejection followed by a later approval is two rows, which is the audit trail.

**The Approval stage is the final stage.** Stages are data (ADR 0003), so the
code does not look for a stage named "Approval"; it treats the stage with the
highest `sequence_order` as the approval gate.

**Entering Approval requires a decision.** A forward transition whose target
is the final stage must carry an approval decision in the same request. The
approval row is created in the same database transaction as the stage
transition, so a product can never be in the Approval stage without a decision
attached, nor have a decision without the matching move.

**A rejection is a backward transition.** If the decision is `REJECTED`, the
product does not enter Approval; the request goes through the *existing*
backward-transition path instead (one step back — from Final Review to
Modification in the seeded workflow), with the rejection `notes` as the
required backward `reason`. It is the same real-world event as a backward move,
now recorded as a decision rather than inferred from `direction: "backward"` +
free text alone. No parallel transition code path is added.

**Who can decide.** An **admin, the product's owner, or a manager assigned to
the product** — the authority set defined by ADR 0004 (Resolutions 6 and 7),
the same one used for forced and backward transitions; no new permission
concept is introduced. Anyone else is rejected with `403`.

*Current implementation is coarser than this rule.* Ownership and stage
assignments don't exist as enforceable data yet (no authentication, no
assignments table), so today the check is simply "the user named in
`decidedById` has the `ADMIN` or `MANAGER` role", for any product. It
tightens to the rule above when the access-control work lands; until then an
owner who is not a manager or admin gets a `403`, and a manager who is
unrelated to the product is allowed.

**Pinning to a version.** The approval stores the product's *current*
`product_version_id` at decision time. Module 2's handoff query is then exactly
"does an `APPROVED` approval exist for this `product_id` + this exact
`product_version_id`" — an indexed lookup that reuses the existing
version-pinning design and invents nothing new. Creating a new version
afterwards does not retroactively approve it.

## Consequences

- **The handoff contract is now explicit and queryable.** Module 2 doesn't
  infer approval from stage position; it reads `approvals`.
- **Rejections are first-class data**, so "how often does Final Review bounce
  back?" becomes answerable later.
- **The transition endpoint gets stricter.** A forward move into the final
  stage without a decision is now a `400`. An approval sent with any other
  transition is also a `400`, so stray approval rows can't be created.
- **The authority check is only as strong as the identity behind it.** There is
  no authentication yet (hand-rolled JWT is a separate, upcoming module), so
  the decider is identified by a `decidedById` field in the request body and
  the `ADMIN`/`MANAGER` check is made against that user's stored role. That
  enforces the rule for well-behaved clients but is not a security boundary:
  anyone can send an admin's id. When JWT auth lands, the decider must come
  from the verified token, and the request field goes away. Until then, treat
  this as a business-rule gate, not access control.
- **The approval gate is the same authority as ADR 0004's transition rules.**
  ADR 0004 is accepted and its resolutions are the reference: backward moves,
  forcing a multi-assignee transition, and triggering a fully signed-off one are
  all limited to an admin, the product's owner, or an assigned manager (its
  Resolutions 2, 6, 7 and 8), and approval decisions use that same set. The
  approval gate should stay in step with it. Until real authentication and
  assignment data exist, only approval decisions are role-gated in the API
  (coarsely, see "Who can decide"); plain backward and forced transitions are
  still not, and this ADR does not add that.
- **An owner can approve their own product.** ADR 0004 Resolution 7 extends the
  owner's local-admin authority to approval decisions, so there is no
  separation of duties between owning and approving. It is an accepted
  trade-off, recorded there.
- **"Final stage = approval gate" is a convention.** If the workflow is later
  extended with a stage *after* Approval, this rule silently moves the gate.
  The clean fix at that point is an explicit `requires_approval` flag on
  `stage_definitions`, which fits ADR 0003 and is a data change, not a rewrite.
- **Approvals are not an ownership signal.** Approving a product does not set
  `actual_completion_date` or change `status`; those remain derived/managed
  elsewhere. Module 2 should key off `approvals`, not off those fields.

### Deferred: `comments` and `attachments`

The original Module 1 schema list also included `comments` and `attachments`.
They are **deliberately deferred** and not part of this change or of Module 1's
completion criteria. They are supporting/UX features — discussion threads and
file uploads on a product — that nothing downstream depends on: Module 2 does
not query them, and adding them later requires no change to existing tables or
to the workflow. Approvals are different: they are a structural handoff
contract that other modules will be built against, which is why they are added
now while `comments` and `attachments` are not. `attachments` additionally
needs a file-storage decision (local disk vs. object storage) that shouldn't be
made speculatively.

## Alternatives considered

- **Infer approval from "the product reached the last stage."** Zero new
  schema, but it loses who decided and when, has no rejection path, and can't
  answer "was this exact version approved?", so Module 2's version-pinned
  lookups would have nothing to key on. Rejected.
- **Add an `approved` boolean (or an `APPROVED` value) to `products`.** Cheap,
  but it is a single mutable flag: it drops the decision history, says nothing
  about *which version*, and is the same manually-maintained-flag pattern ADR
  0003 argues against. Rejected.
- **Record only the final `APPROVED` decision, and keep rejections as plain
  backward transitions.** Smaller table, but splits one real-world event
  (a decision) across two representations and keeps rejections un-queryable.
  Rejected in favour of recording every decision.
- **A separate rejection code path that bypasses the backward-transition
  logic.** Would duplicate the stage-history close/open, delay recompute and
  validation. Rejected; a rejection reuses the backward path.
