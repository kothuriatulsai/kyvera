# 0006 — SOP entity model and ID scheme

## Status

Accepted

## Context

The source for this is NiTISI OPS SOP v1.0 (private, not in the repo), which
is now the source of truth for the product-development workflow, superseding
the self-designed 9-stage lifecycle. It describes a genuinely different shape
of process: not one entity moving through a sequence of stages, but a chain of
distinct, system-generated records — Project, Tech Pack, Proto Request, Proto
Work, Quality Order, Shipping ID, Bulk Request — where completing one stage's
work auto-creates the next record. Several of these records have their own
revision/approval sub-structure (a Tech Pack has versions; a Quality Order
will need dual sign-off in Slice C) that has nothing in common with, say, a
Shipping record's shape.

Modeling this as `current_stage_id` on one row (the existing `Product`
pattern) doesn't fit: there's no single entity whose "stage" this all is —
each stage produces a *different kind* of record, linked by foreign keys, and
several of those records need their own internal state (Tech Pack revisions,
void/reject history) independent of where the parent Project is.

This ADR covers only what Slice A (SOP Stages 1–3) needs. Later slices
(Manufacturer/QA master data, Proto Work, Quality Order, Shipping, Bulk) are
named here for the ID scheme's sake but not modeled yet.

## Decision

**1. Discrete entities, not stage pointers.** Each stage's output becomes its
own table: `Project` (Stage 1), `TechPack` + `TechPackVersion` (Stage 2),
`TechPackConfirmation` + `TechPackApproval` (Stage 3), `ProtoRequest` (Stage
3's output / Stage 4's subject). Later slices add `ProtoWork`, `QualityOrder`,
`Shipping`, `BulkRequest`, `BulkWork` the same way. Auto-created child records
(e.g. approving a Tech Pack creating a Proto Request) are just an insert
performed by the service that handles the parent action, in the same database
transaction — the same pattern the old module already uses for stage
transitions writing `ProductStageHistory` rows.

**2. ID scheme.** Every table keeps a UUID primary key (`id`) — joins and FKs
use it, nothing user-facing does. A separate, unique, human-readable `code`
column is formatted `<PREFIX>-NNNNNN` (at least 6 digits, zero-padded):
`PRJ-`, `TP-`, `PR-`, `PW-`, `QO-`, `SHP-`, `BR-`, `BW-`. Codes carry no
embedded parent reference (no project segment baked into a tech pack's code);
traceability lives entirely in foreign keys.

**Revised approach to generating `code` (supersedes this ADR's first draft,
which used a per-table `sequenceNo Int @default(autoincrement())` plus a
generated column computed from it).** That's dropped. Instead:

- One dedicated Postgres `SEQUENCE` per prefix (`prj_code_seq`, `tp_code_seq`,
  `pr_code_seq`, ...), created by hand in the migration SQL (`CREATE SEQUENCE
  ...`) — Prisma has no native primitive for a bare sequence, so this can't be
  expressed in `schema.prisma` directly.
- A small SQL function, `format_code(prefix text, n bigint) RETURNS text`,
  that pads `n` to *at least* 6 digits without truncating larger numbers:
  `prefix || '-' || lpad(n::text, GREATEST(6, length(n::text)), '0')`. Plain
  `lpad(n::text, 6, '0')` was the earlier draft's bug — Postgres's `lpad`
  *truncates* a string already longer than the target width (from the left),
  so a 7-digit sequence value would silently lose its leading digit past
  `999999`. `GREATEST(6, length(n::text))` makes the target width grow with
  the number instead, so `lpad` only ever pads.
- `code`'s column default calls both: `format_code('PRJ',
  nextval('prj_code_seq'))`. `nextval()` is evaluated once, as an argument, so
  there's no double-increment risk. In `schema.prisma` this is expressed as
  `@default(dbgenerated("format_code('PRJ', nextval('prj_code_seq'))"))` —
  Prisma treats the string opaquely and writes it as the column's `DEFAULT`
  expression verbatim.

**Migration procedure this implies (not run yet):** `prisma migrate dev
--create-only`, then hand-edit the generated SQL to create the sequences and
`format_code()` *before* the `ALTER TABLE ... ADD COLUMN "code" ... DEFAULT
...` statements that reference them (order matters — a default can't cite a
sequence that doesn't exist yet), then apply, then run `prisma migrate dev`
again with no further changes pending to confirm the schema and the database
agree (a `dbgenerated()` default is opaque to Prisma's own diffing, so this
round-trip is the actual check, not an assumption).

**3. Tech Pack = parent + versions.** `TechPack` is one row per TP number.
`TechPackVersion` is one row per uploaded revision (`versionNumber`, uploader,
timestamp, optional notes) — the same parent/append-only-children shape as the
existing `Product`/`ProductVersion` pair. A Management rejection voids the
`TechPack` rather than deleting anything, and a *new* `TechPack` is created
under the same `Project`.

**Void traceability**, added in this revision: `voidedAt`, `voidedById` (who
voided it), `voidReason` (free text), and `supersedesId` — a self-relation on
the *new* `TechPack`, pointing at the voided one it replaces (`@unique`, so a
voided Tech Pack has at most one successor). This makes "what replaced TP-3?"
and "why was TP-3 voided?" direct column reads instead of a join through
`TechPackApproval`, even though the underlying decision record (who, when,
full notes) still lives there too — the two aren't redundant, `TechPack`'s
copy is for traceability on the row itself.

**Files.** `TechPackVersion` does not carry a `fileUrl` column — a version can
have several files (design references plus the tech pack document itself),
so file metadata is a separate `Attachment` table, one row per file, with a
nullable FK to the version it belongs to. See ADR 0008 for the storage
decision this required.

**4. Stage 3 is two sequential single-decision gates, not a dual-approval
gate.** (Correction to my earlier framing.) `TechPackConfirmation` records
Engineering's sign-off on one specific `TechPackVersion` — unique on
`techPackVersionId`, so a version is confirmed at most once, after however
many `TechPackRemark` rows the revision cycle produced. `TechPackApproval`
records Management's decision (reusing the existing `ApprovalDecision` enum:
`APPROVED` | `REJECTED`) and can only target a version that already has a
confirmation, *and only the latest version of the Tech Pack* — both enforced
in the service, not the schema, the same way the old module enforces "must be
the current stage" outside the schema. The SOP's dual-approval requirement
(Product Developer + PMO) belongs to the Quality Order in Slice C and is not
modeled here.

**Planned first service test for this rule:** a Tech Pack with `v2` confirmed
and `v3` uploaded afterward (no confirmation on `v3`) — a Management approval
naming `v3` (the latest version) must be rejected, because the latest version
has no confirmation, even though *some* version of the Tech Pack does. This is
the case that would slip through a check that only asks "does any version have
a confirmation?" instead of "does *this* version?".

**5. Revision remarks get their own table.** `TechPackRemark`
(`techPackVersionId`, `authorId`, `body`, `createdAt`) covers Engineering's
feedback loop with the Product Designer during Stage 3. Same choice already
made for `StageProgressNote` over the deferred generic `comments` table (ADR
0004, Resolution 9): scoped, functional data tied to one review thread, not
free-form discussion, so it doesn't reopen that deferral.

**6. `Project.phase` and `Project.productCategory` are separate fields**,
plus **`TechPack.phase`** (new in this revision). `Project.phase` is an enum,
`PROTO | BULK`, defaulting `PROTO`; `productCategory` is an independent,
optional free-text string. This is a **modeling assumption**, not a confirmed
answer from NiTISI: Stage 1's category input is read as a product-category
label (e.g. "furniture"), unrelated to the Proto/Bulk cycle. Per this
session's direction, Slice A does not block on that being confirmed — if the
answer turns out different, it's a field to revisit, not a structural change.

`TechPack.phase` copies the project's phase at the Tech Pack's creation time,
rather than always reading it live off `Project`, for the same reason
`Approval.productVersionId` pins an exact version: once the Bulk cycle reuses
the same Tech Pack machinery (Slice D), a project's phase moving from `PROTO`
to `BULK` shouldn't retroactively reclassify a Tech Pack that was created,
reviewed and approved while the project was still in Proto.

`Project` also gains **`protoCompletedAt`** and **`completedAt`** (both
nullable `DateTime`) — the two completion events the process describes: the
prototype cycle finishing (which is what triggers the Bulk cycle to start),
and the whole project finishing. Neither is modeled further in Slice A (no
service sets them yet); they're here so Slice A's `Project` doesn't need a
migration revisited in Slice D just to record when its own phases ended.

**7. Manufacturer and 3rd-party QA are master data, not `users` rows.** Not
modeled in Slice A; needed starting Slice B (`ManufacturerMaster`) and Slice C
(`QaResourceMaster`).

**8. `ProtoRequest` is created in Slice A, minimally: `id`, `code`,
`projectId`, `techPackVersionId`, `createdAt`.** No `techPackId` column
(dropped in this revision) — the Tech Pack is always reachable through
`techPackVersion.techPack`, and keeping a second FK that has to agree with the
first is a redundancy with no query it earns its keep on on this table.
`techPackVersionId` is the *exact* approved version, pinned the same way
`Approval.productVersionId` already pins today. Stage 4's fields
(manufacturer, PO, delivery schedule, confirmation) are added to this same
table in Slice B, not a new one — it's one record whose lifecycle spans Stages
3–4.

**9. Every foreign key added by this ADR uses `onDelete: Restrict`**, not the
old module's `Cascade`. Deleting a `Project` or a `TechPack` with any children
— versions, remarks, confirmations, approvals, attachments, proto requests —
is refused at the database level rather than silently fanning out. This is
deliberately stricter than the old module: those records are exactly the
approval/traceability trail this whole domain exists to keep, so nothing here
should make deleting a parent an easy way to lose it. If a real "remove this
Project" need ever appears, it should be a deliberate, service-level operation
(e.g. an explicit archive/cancel state) — not a `DELETE` cascading through
years of sign-offs.

## Consequences

- The object graph is a tree from `Project` down (`Project` → `TechPack` →
  `TechPackVersion` → `{Attachment, TechPackRemark, TechPackConfirmation,
  TechPackApproval}`, plus `Project` → `ProtoRequest` → `TechPackVersion`,
  plus `TechPack` → `TechPack` via `supersedes`), rather than a single row
  with a stage pointer. Querying "where is this project" means walking the
  tree, not reading one column.
- `code`'s default now depends on hand-maintained migration SQL (the sequence
  + `format_code()` function) that `schema.prisma` alone can't express or
  regenerate — a fact worth a one-line comment at each `dbgenerated()` site so
  a future schema change doesn't assume Prisma owns the whole default.
- `onDelete: Restrict` means a test suite or seed script that deletes a
  `Project` mid-run must delete its whole subtree in dependency order first
  (or not delete Projects at all) — more ceremony than the old module's tests,
  which was the point.
- Every new table needs its own repository/service, following ADR 0007's
  coexistence rules — more files than a single generic module, which is the
  intended trade-off (see ADR 0007 Consequences).
- Because `TechPackApproval` reuses `ApprovalDecision`, adding a third
  decision value later (if one is ever needed) affects both domains at once —
  accepted, since `APPROVED`/`REJECTED` is genuinely the same concept in both
  places, not a coincidence.

## Alternatives considered

- **Encode parent IDs in the code string** (e.g. `TP-PRJ000123-01`) —
  rejected; relationships stay in foreign keys, codes stay uninformative.
- **A per-table `sequenceNo Int @default(autoincrement())` plus a Postgres
  *generated* column for `code`** — this ADR's first draft. Rejected on
  review: `lpad` alone truncates past 6 digits (the bug described above), and
  a generated column can't be expressed in `schema.prisma` either, so it
  bought no real simplicity over a plain sequence-backed default while adding
  an extra always-incrementing column with no reader.
- **One shared `id_sequences` counter table**, incremented under an
  application-level lock — rejected: a dedicated Postgres `SEQUENCE` per
  prefix is already atomic and race-free with no extra code.
- **`code` computed and written by the application** (create, then update
  once an ID is known) instead of a database default — rejected: two writes
  per create across every new table, versus one `DEFAULT` expression that
  can't be forgotten.
- **A status enum on `TechPack`** (`DRAFT` / `CONFIRMED` / `APPROVED` /
  `VOID`) instead of separate append-only `TechPackConfirmation` /
  `TechPackApproval` rows — rejected for the same reason `Approval` isn't a
  boolean on `Product`: it drops who decided, when, and the revision history
  those two tables need to stay queryable.
- **Reuse `ProductVersion` / `Approval` for tech packs** — rejected; see ADR
  0007 (coexistence: the old module's tables are untouched until removed).
- **`fileUrl` on `TechPackVersion`** (this ADR's first draft) — replaced by a
  dedicated `Attachment` table; see ADR 0008 for the reasoning.
