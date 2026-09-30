# 0008 — Attachment storage (local disk in dev, swappable behind an interface)

## Status

Accepted

## Context

A Tech Pack version needs real files attached to it — design references and
the tech pack document itself, which may be CAD, PDF, Word, or image files,
and there can be more than one per version. ADR 0006 gives these their own
table, `Attachment` (metadata only: storage key, original filename, MIME
type, size, uploader, timestamp, and a nullable FK to whichever entity owns
it), rather than a single `fileUrl` string column on `TechPackVersion`.

The old module's own ADR (0005) deferred an `attachments` table entirely,
specifically because *where the bytes live* (local disk vs. object storage)
"shouldn't be made speculatively," and nothing downstream depended on it yet.
That reasoning doesn't carry over here: something downstream depends on it
now — Stage 2 of the SOP can't be represented without it. This ADR makes the
storage decision the old ADR chose not to.

## Decision

**1. `Attachment` rows store metadata only.** The file's bytes live behind a
storage layer, addressed only by the opaque `storageKey` column — nothing
above that layer parses or constructs the key itself.

**2. A small storage interface**, in `apps/api/src/services/storage/`:

```ts
interface AttachmentStorage {
  save(input: { buffer: Buffer; suggestedName: string }): Promise<{ storageKey: string }>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}
```

Exact method shapes (buffer vs. stream, for instance) are implementation
detail to settle when the upload endpoint is built — the interface's job is
just to keep "where bytes live" swappable, not to fully spec the HTTP layer
now.

**3. Dev implementation: `LocalDiskStorage`.** Writes under
`apps/api/uploads/` (gitignored, the same treatment as the local `.env`).
`storageKey` is a randomly-generated filename, never derived from the
uploaded file's original name — the original name is stored separately
(`Attachment.originalName`, for display only) and never used as a path
segment, so a malicious filename can't attempt path traversal.

**4. Swappable later.** An S3-compatible implementation satisfies the same
interface when a real deployment target exists; nothing above the storage
layer — `Attachment` rows, the repository, the services that create them —
changes. Same reasoning ADR 0001 gives for choosing Prisma partly because the
ORM "could theoretically be swapped later."

**5. Not decided or built by this ADR:** the upload HTTP endpoint itself
(multipart handling, size/type limits), virus scanning, and how a file is
served back out (a redirect, a signed URL, a proxied stream). Those are Slice
A implementation work once the schema is in place, not a schema/storage
decision.

## Consequences

- An `Attachment` row can only outlive its bytes if `delete()` isn't called
  consistently. ADR 0006's `onDelete: Restrict` on `TechPackVersion` exists
  partly for this reason — an attachment's owner can't be deleted out from
  under it — but an explicit attachment-delete path (if one is ever needed)
  must call `storage.delete()` and the database delete together, or the two
  can drift.
- Local dev/CI need no new infrastructure; a real deployment eventually needs
  either a persistent volume for `apps/api/uploads/` or the object-storage
  implementation — not required for Slice A's schema work, flagged for when
  the upload endpoint is built.
- `sizeBytes` is recorded, not enforced — any size/type limit is an
  upload-endpoint concern, not a schema constraint.
- The table name `attachments` was available: the old module's ADR 0005 only
  *deferred* an `attachments` table, it never built one, so there's no
  collision to design around.

## Alternatives considered

- **Store file bytes as `bytea` in Postgres** — rejected: bloats the primary
  database, its backups and its replication with content that has no
  relational structure of its own; a KV/object store is the conventional fit,
  and this project's database is meant to stay about relationships, not
  blobs.
- **Decide on S3-compatible object storage now instead of local disk** —
  rejected for the same reason the old ADR gave for deferring the whole
  table: no real deployment target needs it yet, and the interface means
  deferring costs nothing later.
- **A polymorphic owner** (`ownerType` + `ownerId` columns instead of one
  nullable FK per attachable entity) — rejected: it trades away real foreign-key
  integrity, which is the entire argument ADR 0001 makes for Postgres over a
  document store. `Attachment` is expected to grow one more nullable FK column
  per new attachable entity as later slices need them (a PO in Slice B, for
  instance), the same way `ProductStageHistory` already carries more than one
  optional actor column.
