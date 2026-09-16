# 0001 — PostgreSQL over MongoDB

## Status

Accepted

## Context

Kyvera needs a database for a business operations platform covering product
development, manufacturing orders, logistics, inventory, supplier
management, and budget/expense tracking. The domain has a lot of structural
relationships: products reference owners and versions, manufacturing orders
will reference a specific product version, budget line items will need to
aggregate across products/orders/categories, and every entity with
meaningful state changes needs a paired audit/history table.

The developer's background is strong in JavaScript/TypeScript, with SQL as a
deliberate growth area — this project is partly meant to build relational
modeling fluency.

## Decision

Use PostgreSQL as the primary datastore, accessed through Prisma.

## Consequences

- Foreign keys and constraints give real relational integrity for
  cross-module references (e.g. `manufacturing_orders.product_version_id`),
  instead of relying on application-level consistency checks.
- Aggregation queries for budget vs. spend vs. committed, and future
  reporting/dashboard needs, map naturally onto SQL joins and aggregates.
- Prisma migrations are versioned in git, doubling as a schema design
  journal alongside `docs/journal/`.
- Schema changes require explicit migrations rather than ad hoc document
  shape changes — more upfront rigor, which is intentional here.
- The project doubles as practice for relational schema design and SQL,
  which is an explicit goal, not just an implementation detail.

## Alternatives considered

- **MongoDB** — flexible schema would be convenient early on, but the
  domain is deeply relational (multi-entity references, audit trails,
  budget aggregation across entities). Modeling that well in a document
  store means either denormalizing heavily (creating consistency risk) or
  effectively rebuilding relational joins in application code. Rejected.
- **SQLite** — fine for a prototype, but doesn't reflect a realistic
  production setup, and this project is explicitly meant to demonstrate
  real engineering practice. Rejected.
