# 0014 — "My tasks" and notifications

## Status

Accepted and implemented, 2026-10-10. Builds on ADR 0013 (project
visibility) without changing any of its rules.

## Context

Every SOP role's experience since Slice A has been purely reactive: the
only way to find out something needs your attention is to browse to a
Project or Tech Pack and check its state by hand. ADR 0013 made that safe
to automate - `services/visibility.ts` already knows, for any actor,
exactly which Projects/Tech Packs/versions they're allowed to see. This
ADR builds two features on top of it, without touching visibility's rules
themselves:

1. **"My tasks"** - a per-role worklist, `GET /me/tasks`, computed fresh on
   every request and never stored.
2. **Notifications** - a stored, append-only event log for the moments the
   brief calls out: a version uploaded, a remark added, a confirmation, an
   approval, a rejection (with its successor), and being added to or
   removed from a Project.

## Decision

**1. Tasks are computed, not stored, and are built strictly on top of
`visibility.ts`'s existing exports** (`visibleProjectIds`,
`techPackStageWhere`) - never a new, parallel set of access checks. A task
can never point at something its viewer isn't allowed to open, because the
query behind it is scoped exactly the way any other SOP read is.
`taskService.listMyTasks(actor)` dispatches on role:

- **`PRODUCT_DESIGNER`**: a member Tech Pack with zero versions ever →
  "Upload v1"; a member Tech Pack whose latest version is unconfirmed *and*
  whose latest remark was left by someone other than a `PRODUCT_DESIGNER`
  → "New remarks" (see point 2 below for why remark-authorship, not just
  remark-existence, decides this).
- **`ENGINEERING`**: a member Tech Pack whose latest version is unconfirmed
  *and* whose latest remark (if any) wasn't left by `ENGINEERING` itself →
  "Review". If the latest remark *was* Engineering's own, the task is
  suppressed - they're the one waiting, not the one with something to do.
- **`MANAGEMENT`**: a Tech Pack whose latest *confirmed* version has no
  decision yet, provided there isn't a newer, still-unconfirmed version on
  top of it (the same `hasPendingNewerVersion` condition ADR 0013 added to
  `visibleTechPackDetail`, recomputed here against the narrower fields this
  query needs) → "Decide".
- **`PMO`**: a Project with zero Tech Packs ever (PMO is see-all, so no
  membership scoping) → "Waiting for design".
- **`ADMIN`, `FINANCE`, `MERCHANDISER`**: always `[]` - Slice B adds
  Finance/Merchandiser tasks; ADMIN's role here is account administration,
  not workflow, same framing as ADR 0009's no-carve-out stance.

**2. Remark-authorship, not remark-existence, decides whose task it is.**
A remark thread has direction: Engineering leaving a remark means it's the
designer's turn to respond, and vice versa. Both `PRODUCT_DESIGNER`'s
"respond to remarks" task and `ENGINEERING`'s "Review" task key off the
*latest* remark's author role on the latest version, not merely whether
any remark exists - otherwise Engineering's own "Review" task would never
clear after they left feedback, and the designer's task wouldn't clear
after they replied. Message wording stays role-agnostic ("New remarks on
{code} v{n}") since the latest remark's author could in principle be
`ADMIN` or `PMO` too (both may post remarks).

**3. Notifications are a stored, append-only `Notification` table**
(`recipientId`, `type`, `message`, `link`, `createdAt`, `readAt`), written
in the *same transaction* as the action that causes it - never a
best-effort side call after the fact. `onDelete: Restrict` on
`recipientId`, matching the rest of the SOP domain's audit-relevant tables
(`ProjectMemberHistory`), not `UserSession`'s `Cascade` exception: this is
event history, not ephemeral auth state.

**4. Recipients, per event - "whose task just changed", extended to
approve/reject even though no new task results from those specifically:**

| Event | Recipients | Link |
|---|---|---|
| Version uploaded (new Tech Pack or new version) | `ENGINEERING` members of the Project | Tech Pack detail |
| Remark added | `ENGINEERING` + `PRODUCT_DESIGNER` members of the Project (minus the actor) - remarks are a two-way thread | Tech Pack detail |
| Version confirmed | `PRODUCT_DESIGNER` members of the Project + every active `MANAGEMENT` user | Tech Pack detail |
| Version approved | `PRODUCT_DESIGNER` members of the Project + every active `PMO` user | Proto Request detail |
| Version rejected (successor created) | `PRODUCT_DESIGNER` members of the Project + every active `PMO` user | the successor Tech Pack's detail |
| Member added | the added user only | the Project's detail page |
| Member removed | the removed user only | **`/` (home)**, not the Project - ADR 0013 would 404 it the instant they tried; the message names the Project by code instead |

`MANAGEMENT`/`PMO` are notified as "every active user of that role", not
via `ProjectMember` - they're see-all roles (ADR 0013), so "everyone who
can see this" is the role, not a membership row. `ADMIN` is never a
recipient of a workflow event, for the same reason it has no tasks. The
actor is always excluded from their own event's recipients, on top of
whatever the table above says.

**5. Every write service that produces one of these events calls a
`notificationService.notify*` helper from inside its existing
`prisma.$transaction`**, not after it - `techPackService.createTechPack`/
`uploadTechPackVersion`, `techPackReviewService.confirmTechPackVersion`,
`techPackDecisionService.decideTechPackVersion`,
`projectService.addMemberRow`/`removeMember`. `addTechPackRemark` wasn't
transactional before this - wrapped it in a new `prisma.$transaction` so
the remark and its notifications land atomically, with no change to its
visibility pre-check or return value.

**6. Background badge polling must be fully inert to the ADR 0012
refresh/idle-timeout machinery.** The web app adds exactly one new
`fetch`-based primitive, `apiGetSilent` (`api/client.ts`), used only by the
nav's task-count badge and the notification bell's unread count
(`hooks/useBackgroundCounts.ts`, on a 60s `usePolling` interval, paused
while the tab is hidden). It deliberately bypasses `rawFetch` entirely - no
`onRefreshNeeded`/`onSessionEnded`/`onForbidden`, and no interaction with
`AuthProvider`'s `activityRef`. A 401 from a stale token mid-poll just
resolves to `null`; the next real, user-initiated request still goes
through the normal reactive-refresh path. This was a deliberate new
primitive rather than a flag threaded through `rawFetch`'s existing
branches, to avoid any risk of changing that well-tested 401 path.

**7. `/` is now "My tasks" for every role**, replacing the implicit
`ProjectListPage` default; `/projects` is unchanged. A bell
(`NotificationBell`) in the header shows the live-polled unread count and
opens a small dropdown that fetches the first page of real notifications
on open (a deliberate user action, through the normal `apiGet` path - not
the silent poll). `/notifications` is the full paged history, with
"Mark all as read".

## Consequences

- `apps/api/tests/helpers/auth.ts#cleanupTestUsers()` now deletes
  `Notification` rows for the test users it created before deleting the
  users themselves - a notification is a side effect of some *other*
  action, addressed to a recipient a test may not hold a direct reference
  to (e.g. every `ENGINEERING` member of a Project), so there's no single
  "delete what I made" call site for these the way there is for a
  Project/TechPack.
- **Test files now run sequentially** (`fileParallelism: false` in
  `vitest.config.ts`). "Notify every active user of role X" is a genuine
  cross-file race once it's true: a confirm/approve/decide in one test
  file can insert a `Notification` row for a `MANAGEMENT`/`PMO` test user
  a *different*, concurrently-running file just created or is mid-cleanup
  on - surfaced first as an intermittent 500 (two queries landing on one
  interactive transaction's single connection, from an earlier attempt at
  resolving recipients concurrently inside the transaction) and then as an
  intermittent FK violation during cleanup. Running files sequentially
  removes the race instead of chasing each symptom.
- Every `notify*` helper's recipient-id queries run sequentially inside
  the transaction (no `Promise.all` on the shared `tx` client) - an
  interactive transaction holds a single connection, and two queries fired
  concurrently on it race.
- `packages/shared-types` gains `Task`/`TaskType` and
  `Notification`/`NotificationType`/`NotificationPage`, following the
  existing `as const` array + derived-union-type convention.
- `e2e/smoke.spec.ts` updated for `/` now landing on "My tasks" instead of
  "Projects" - both tests click the "Projects" nav link explicitly before
  continuing.

## Alternatives considered

- **Give Management's "Decide" task condition its own visibility-module
  export**, reusing `visibleTechPackDetail` directly - rejected: that
  function's generic `TechPackLike`/`VersionLike` shape expects a
  `remarks` field the task query has no reason to select, and the
  condition here ("does this item need action") is a different kind of
  question from visibility's ("is this item reachable at all"), even
  though both start from the same `techPackStageWhere` filter. Kept the
  two concepts separate rather than overloading one function to answer
  both.
- **Thread a `silent` option through `rawFetch`** instead of a standalone
  `apiGetSilent` - rejected per point 6: the existing 401/403 handling in
  `rawFetch` is exactly the thing that must never fire for a background
  poll, and a boolean flag through that same function risked a subtle
  change to a path already covered by `auth.test.tsx`'s own tests.
- **Notify Management on a version upload/unconfirmed remark too** (so
  they always know everything that happened) - rejected per the brief's
  own example: Management's job is to decide on confirmed versions, not
  track review-loop chatter, the same reasoning ADR 0013 already applied
  to stripping remarks from Management's view entirely.
