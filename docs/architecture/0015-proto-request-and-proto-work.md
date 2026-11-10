# 0015 — Manufacturer master, Proto Request Stage 4, Proto Work (Stage 5)

## Status

Accepted and implemented, 2026-11-06. Point 7 revised 2026-11-08, before merge.

## Context

Slice A (ADR 0006/0007/0008/0009, hardened by ADR 0013's visibility model and
ADR 0014's tasks/notifications) covers SOP Stages 1-3: Project -> Tech Pack
-> Engineering confirmation -> Management approval -> `ProtoRequest`
created. Slice B is the SOP's Stage 4 (§8: assign a manufacturer, negotiate
commercial terms, Finance uploads the PO, confirm) and Stage 5 (§9: the
confirmed request is released to a Work Queue, PMO assigns a Merchandiser,
who tracks the manufacturer's progress and reconfirms the delivery date at
intervals, then marks the work completed). Stage 6 (Quality Order) and
`QaResourceMaster` are Slice C's and are not modeled here - this ADR stops
exactly where the confirmed-work lifecycle described by steps 20-23 stops.

## Decision

**1. `ManufacturerMaster` is master data, not a `users` row** (ADR 0006
point 7) - `id, name, contactName?, contactEmail?, contactPhone?, isActive,
createdById, createdAt`. Deliberately **no `code`**: the SOP's own §12
traceability table lists a system-generated code for every lifecycle record
it names, and does not for Manufacturer - read as a deliberate signal that
it isn't part of that ID chain, the same way ADR 0006 point 7 already
treats Manufacturer as master data rather than a lifecycle entity.
Deactivated, never deleted, like `User`; every FK to it (`ProtoRequest.
manufacturerId`) is `onDelete: Restrict`.

Management is PMO/ADMIN-only end to end (`/manufacturers`), reads included -
narrow operational data for the assign-manufacturer picker, the same framing
ADR 0013 point 6 already used for `GET /projects/:id/members/candidates`
over relaxing `GET /users`. No other role has a reason to browse the full
roster: the manufacturer *assigned* to a given Proto Request travels on
that Proto Request's own response for every role that can see it at all.

**2. Stage 4's fields are added directly to `ProtoRequest`**, not a new
table - ADR 0006 point 8 already called this out as one record whose
lifecycle spans Stages 3-4, and that holds for Stage 4's own sub-steps too.
All new fields are nullable, populated progressively as PMO/Finance work
through steps 15-19, and locked in once `confirmedAt` is set:
`manufacturerId/manufacturer`, `manufacturerAssignedAt/By`, `commercialNotes`
(steps 15-16); a `poAttachment` back-relation (step 17, see point 3);
`agreedDeliveryDate`, `confirmationNote`, `confirmedAt/By` (steps 18-19).

Reassignment (`POST .../manufacturer` again) is allowed any time before
confirmation - the SOP doesn't forbid revising the manufacturer choice
mid-negotiation, and locking it on first assignment would make a PMO typo
or a renegotiation unfixable short of voiding the whole Proto Request.
Every Stage 4 write 409s once `confirmedAt` is set.

**3. The PO is an `Attachment` owned by the `ProtoRequest`, via a new
nullable, `@unique` `protoRequestId` column on `Attachment`** - exactly what
ADR 0008's own comment predicted ("more owner columns are added here as
later slices need them, e.g. a purchase order in Slice B"). `@unique`
enforces one PO per Proto Request at the database level, the same shape as
`TechPackConfirmation.techPackVersionId`. No separate `poUploadedAt/By`
columns on `ProtoRequest` - `poAttachment.uploadedAt/uploadedBy` already
carries that, and there's a direct 1:1 relation to join, unlike `TechPack.
voidReason` (which exists precisely because `TechPack` has no single child
row to read that from).

Uploading is a 409 once a PO already exists (no silent replace) and once
the Proto Request is confirmed - fixing a wrong PO is a human/support
action, not an API path, matching this project's general stance that
correcting a mistake is a deliberate, visible action (e.g. a rejected Tech
Pack gets a new TechPack number, not a silent file swap) rather than an
invisible overwrite of something already relied upon downstream.

**4. `ProtoWork` is Stage 5's own entity** (ADR 0006 point 8's table named
it for Slice B specifically), code `PW-`, one row per confirmed
`ProtoRequest` (`protoRequestId` is `@unique`): `status` (`QUEUED` ->
`ASSIGNED` -> `COMPLETED`), the assigned Merchandiser (`assignedMerchandiserId/
At/By`), `currentDeliveryDate` (seeded from `ProtoRequest.agreedDeliveryDate`
at creation), and `completedAt/By`. `projectId` is denormalized directly on
the row - the same choice `ProtoRequest` already made for the same reason
(every list query at this level filters by Project).

Created inside `protoRequestService.confirmProtoRequest`'s own transaction,
immediately after `ProtoRequest.confirmedAt` is set - Stage 4's confirm *is*
the "release to the Work Queue" the SOP describes (step 19), not a separate
action.

**5. Delivery-date reconfirmation (step 22) is current state + append-only
history**, the same shape this project has used since `ProjectMember`/
`ProjectMemberHistory` and reused for `TechPack`'s void fields:
`ProtoWork.currentDeliveryDate` is the live value; `ProtoWorkDeliveryConfirmation`
(`protoWorkId, deliveryDate, confirmedById, confirmedAt, notes?`) is the
append-only trail. Only `MERCHANDISER`/`ADMIN` may post one; 409s once the
`ProtoWork` is `COMPLETED`.

**No notification on a routine reconfirmation.** It resets only the
reconfirming Merchandiser's own task clock and creates no one else's task -
the same reasoning ADR 0014 already used to reject notifying Management on
every Tech Pack version upload.

**6. Step 21's "remarks/chat updates" get their own table,
`ProtoWorkUpdate`** (`protoWorkId, authorId, body, createdAt`) - the same
scoped-functional-table shape as `TechPackRemark`, not the generic
`comments` table ADR 0004 already deferred. Open to every Stage 5 process
owner the SOP's role table names for this stage (PMO/Merchandiser/
Engineering) plus ADMIN. No notification on a new update either - the SOP
describes this as a working log for whoever's tracking the work, not a
turn-based review thread like `TechPackRemark`'s Engineering/Designer
exchange, so there's no "whose task just changed" question it answers.

**7. Revised 2026-11-08: once a Proto Work has an assigned Merchandiser,
only that Merchandiser (not any `MERCHANDISER` member of the Project) may
reconfirm the delivery date, post an update, or complete it.** This
reverses the original decision ("workload-tracking metadata, not an
access-control boundary"), which turned out to be wrong in practice: a
Project with two Merchandiser members let the second one act on work that
wasn't theirs, with no record of why they were touching it. The check
(`protoWorkService.assertIsAssignedMerchandiser`) only fires once someone
is actually assigned - a `ProtoWork` still `QUEUED` (`assignedMerchandiserId`
null) skips it entirely, so "nobody's assigned yet" stays a 409 business-
rule failure (from the caller's own check) rather than a 403 blaming
whichever Merchandiser happened to call it. `ADMIN` is unaffected - it was
never "assigned" to begin with, so the check never matches it. PMO/ADMIN's
own actions (assign, reassign) are untouched; this only restricts the three
Merchandiser-facing writes. A `GET` is still layer-A-only, unrestricted - a
non-assigned member Merchandiser can still *see* the Proto Work, just not
act on it.

**8. Completion requires having been assigned first** - `complete` 409s a
`ProtoWork` still `QUEUED`, matching the SOP's own sequencing (assign, then
track, then complete) rather than letting a never-assigned record skip
straight to done.

**9. `ProtoWork` has no stage-level (layer B) restriction of its own -
layer A only**, the identical rule ADR 0013 already set for `ProtoRequest`
("no further stage-level restriction beyond layer A"). Any role that's a
member of (or sees all of) the Project sees its Proto Work the same way it
already sees that Project's Proto Requests.

**10. ADMIN is a carve-in on every new gate, not a carve-out.** ADR 0009's
"no ADMIN carve-out" is a *named, narrow* exception for two specific
technical sign-off gates (Engineering confirm / Management decide) -
genuine adjudication between independent parties. Nothing in Slice B is
that: PMO assigning a manufacturer or confirming, Finance uploading a PO, a
Merchandiser reconfirming a date, are all single-party operational actions,
the same category ADR 0007/0009 already put PMO's "create a Project" in
(which includes ADMIN). So every new write gate lists ADMIN alongside its
primary role(s).

**11. "My tasks" (ADR 0014) gains three PMO contributions** (a Proto
Request with no manufacturer -> `ASSIGN_MANUFACTURER`; manufacturer + PO
set, not yet confirmed -> `CONFIRM_PROTO_REQUEST`; a `ProtoWork` still
`QUEUED` -> `ASSIGN_MERCHANDISER`) **plus the first tasks FINANCE and
MERCHANDISER have ever had** (`UPLOAD_PO`; `RECONFIRM_DELIVERY_DATE`, gated
by a new `DELIVERY_RECONFIRMATION_INTERVAL_DAYS = 7` constant - the SOP only
says "regular intervals", so this is a judgment call kept as one easily-
revisited constant, not parsed from the source document). **ENGINEERING
gets no new task** for Stage 5 despite being named a process owner in the
SOP's role table - no concrete system action is described for them there
(unlike Stage 3's explicit "reviews... confirms"), so adding one would be
inventing a requirement rather than following one.

**12. Five new notification events**, same rule as every existing one
(written inside the triggering service's own transaction, actor excluded,
`ADMIN` never a recipient): manufacturer assigned -> Project's `FINANCE`
members; PO uploaded -> every active `PMO`; Proto Request confirmed (Proto
Work queued) -> every active `PMO`; Proto Work assigned -> that
Merchandiser only; Proto Work completed -> every active `PMO`. The last one
notifies "whose task just changed" even though Slice C's Quality Order
isn't modeled yet to receive it - the same thing ADR 0014 already did for
approve/reject, where the notification exists ahead of the task list entry
it will eventually pair with.

## Consequences

- `Attachment` now has two nullable owner columns (`techPackVersionId`,
  `protoRequestId`); `attachmentService.downloadAttachment` and
  `visibility.ts` each gained a second branch to match -
  `assertProtoRequestPoVisible` mirrors `ProtoRequest`'s own layer-A-only
  rule, deliberately not reusing `assertAttachmentVisible`'s Tech-Pack-
  specific stage logic.
- `notificationService.projectMemberIdsByRole`'s role union gained
  `"FINANCE"` (needed for the manufacturer-assigned event);
  `activeIdsByRole` already supported `"PMO"`, no change needed there.
- `taskService` gained a second judgment-call constant alongside none
  before it - `DELIVERY_RECONFIRMATION_INTERVAL_DAYS` - worth revisiting if
  NiTISI ever states a real interval.
- Every new write service follows the lock-then-check-then-write shape
  `techPackReviewService`/`techPackDecisionService` already established
  (`lockById` under `FOR UPDATE` before any business-rule check), so Stage
  4's three progressive writes and Stage 5's assign/complete can't race
  each other or a repeat of themselves.
- Test fixtures needed a deeper FK-respecting teardown than before (a
  TechPack's chain can now run through a confirmed `ProtoRequest` into a
  `ProtoWork` and its own children) - centralized in a new
  `tests/helpers/cleanup.ts` rather than copy-pasted into every file that
  touches this chain, the first time this project has shared test teardown
  logic instead of duplicating it per file.
- `packages/shared-types` gains `ManufacturerMaster`, `ProtoWork`/
  `ProtoWorkStatus`/`ProtoWorkDeliveryConfirmation`/`ProtoWorkUpdate`, the
  Stage 4 fields on `ProtoRequest`, request bodies for every new endpoint,
  and widened `Task`/`TaskType`/`NotificationType` unions.
- (2026-11-08) `protoWorkRepository.findScopeById`'s select widened to carry
  `assignedMerchandiserId`/`status`, so point 7's ownership check and the
  pre-existing visibility check share one query instead of two.
- (2026-11-08) Two sequencing gaps closed, both found while verifying the
  checks above manually: `protoRequestService.uploadPo` didn't require a
  manufacturer to be assigned first (the SOP's own step order, 15-16 before
  17, was described in this ADR's prose but never actually enforced in
  code); `protoWorkService.addUpdate` had no `COMPLETED` guard at all, so a
  chat update could be posted on work that was already done. Both now 400/
  409 respectively, matching every other Stage 4/5 precondition.

### Endpoint x role matrix

ADMIN included on every write below (point 10); omitted from the table for
width. Reads are layer A only (point 9). `MERCHANDISER` in the three
starred rows means *the Merchandiser assigned to this Proto Work*, once one
is assigned (point 7) - a different `MERCHANDISER` who is only a Project
member gets 403 there, not the 201 the column implies for the assignee.

| Endpoint | PMO | FINANCE | ENGINEERING | MERCHANDISER | PRODUCT_DESIGNER/MANAGEMENT | non-member |
|---|---|---|---|---|---|---|
| `GET /manufacturers`, `POST`, `PATCH`, `.../deactivate`, `.../reactivate` | 200/201 | 403 | 403 | 403 | 403 | n/a |
| `POST /proto-requests/:id/manufacturer` | 201 | 403 | 403 | 403 | 403 | 404 |
| `POST /proto-requests/:id/po` (400 if no manufacturer assigned yet) | 403 | 201 | 403 | 403 | 403 | 404 |
| `POST /proto-requests/:id/confirm` | 201 | 403 | 403 | 403 | 403 | 404 |
| `GET /proto-work`, `GET /proto-work/:id` | all | member-filtered | member-filtered | member-filtered | member-filtered (MANAGEMENT: all) | excluded/404 |
| `POST /proto-work/:id/assign` | 201 | 403 | 403 | 403 | 403 | 404 |
| `POST /proto-work/:id/delivery-confirmations`* | 403 | 403 | 403 | 201 | 403 | 404 |
| `POST /proto-work/:id/updates`* | 201 | 403 | 201 | 201 | 403 | 404 |
| `POST /proto-work/:id/complete`* | 403 | 403 | 403 | 201 | 403 | 404 |
| `GET /attachments/:id/download` (a PO) | 200 | 200 | 200 | 200 | 200 | 404 |

## Alternatives considered

- **A status enum on `ProtoRequest`** (`DRAFT`/`MANUFACTURER_ASSIGNED`/
  `PO_UPLOADED`/`CONFIRMED`) instead of nullable fields plus `confirmedAt` -
  rejected for the same reason ADR 0006 rejected one on `TechPack`: it drops
  who did each step and when, which the nullable-fields-plus-timestamps
  shape keeps for free as plain column reads.
- **Reusing `TechPackRemark`'s table for `ProtoWorkUpdate`** via a second
  nullable FK - rejected; different entity, and the existing "new owner
  column per new attachable thing" precedent (`Attachment`) together with
  ADR 0004's "no generic comments table" stance both point at a dedicated
  table, not a shared one with two optional parents.
- **A `code` for `ManufacturerMaster`** for consistency with every other
  SOP record - rejected per point 1: the SOP's own traceability table
  doesn't list one for Manufacturer, and master data that isn't part of the
  stage-to-stage ID chain doesn't need one just for symmetry.
- **Restricting Proto Work writes to the specifically assigned
  Merchandiser** - this ADR's *original* stance (no existing SOP role/action
  elsewhere in the codebase worked that way, e.g. Tech Pack confirmation
  isn't tied to a specific assigned Engineer). Reversed 2026-11-08 per point
  7: unlike Tech Pack confirmation, a Proto Work's assignment is a real,
  one-to-one "this is whose job it is" relationship the SOP's own Work Queue
  step establishes, not incidental project membership - a second Merchandiser
  acting on someone else's assignment is a real problem this domain doesn't
  have an analogue for elsewhere.
- **Notifying on a routine delivery-date reconfirmation** (so PMO always
  knows the latest date) - rejected per point 5, same reasoning ADR 0014
  already applied to version-upload noise for Management.
- **A `GET /manufacturers` open to any authenticated SOP role** (so e.g.
  Finance could see who they're dealing with) - rejected; the assigned
  manufacturer's own details already travel on the Proto Request response
  itself for anyone who can see that record, so there's no real need for
  Finance/Merchandiser/Engineering to browse the full roster, and keeping it
  PMO/ADMIN-only matches ADR 0013 point 6's narrow-picker precedent.
