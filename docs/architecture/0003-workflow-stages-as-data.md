# 0003 — Workflow stages as data

## Status

Accepted

## Context

Module 1 tracks products through a development workflow (e.g. Requirement →
Initial Design → Engineering → Review → Prototype → Testing → Modification →
Final Review → Approval). Each stage has an expected duration, and delay
computation needs to compare how long a product actually spent in a stage
against that expectation, then cascade the impact onto the product's
expected completion date.

The workflow itself is not fixed forever — stages, their order, and their
expected durations are things a real operations team would tune over time
(add a stage, reorder review before prototyping, adjust an unrealistic
duration) without that being a code change or a deploy.

## Decision

Model the workflow as data, not a hardcoded enum:

- `stage_definitions` (`StageDefinition` in `schema.prisma`) holds each
  stage's `name`, `sequence_order`, and `expected_duration_days`.
- `product_stage_history` (`ProductStageHistory`) records every stage a
  product has actually passed through: `entered_at`, `exited_at`,
  `actual_duration_days`, whether it was `delayed`, and why.
- `products.current_stage_id` is a foreign key into `stage_definitions`,
  not a string/enum column.

Delay computation lives in the service layer as a derived calculation
(`entered_at + stage.expected_duration_days` vs. actual/current date), not
as a flag someone sets manually. `product_stage_history` is both the audit
trail and the source of truth that computation reads from.

The initial nine stages are seeded via `apps/api/src/prisma/seed.ts` as
starting data, not compiled into the schema or application code.

## Consequences

- Adding, reordering, renaming, or re-timing a stage is a data change
  (`stage_definitions` row), not a migration or a redeploy.
- `sequence_order` is unique and is what "can't skip stages" / "moving
  backward requires a reason" validation (Module 1 step 3) is checked
  against, rather than an implicit enum ordering.
- Delay status is never stored as a raw boolean set by a human — it's
  recomputed from `entered_at` + `expected_duration_days`, so it can't
  drift out of sync with reality the way a manually-maintained flag could.
- Slightly more indirection than a TypeScript enum: every stage reference
  is a foreign key lookup rather than a compile-time-checked literal. This
  is deliberate — the alternative (hardcoded stages) is exactly what this
  ADR exists to avoid.

## Alternatives considered

- **Hardcoded `enum ProductStage`** in `schema.prisma` (Postgres native
  enum) — simpler to reference and compile-time safe, but changing the
  workflow would mean a migration + redeploy every time, and there'd be
  nowhere to hang `expected_duration_days` or a human-readable name per
  stage. Rejected.
- **Stage config in a JSON/TS file instead of a database table** — avoids
  a join, but stage data (name, duration) stops being queryable/joinable
  from `product_stage_history`, and stops being editable without a code
  change — same problem as the enum, one layer down. Rejected.
