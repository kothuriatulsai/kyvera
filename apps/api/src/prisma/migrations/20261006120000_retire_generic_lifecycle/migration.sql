-- Retires the generic 9-stage lifecycle module (ADR 0007's original plan,
-- recorded as done in ADR 0010): Slice A proved the SOP domain works end to
-- end, so the old Product/stage schema and the legacy MANAGER/ENGINEER roles
-- go away in this migration. Dev data only - this is destructive and is not
-- meant to run against anything else.
--
-- Order matters here, deliberately different from a plain schema diff:
--   1. Drop the old module's foreign keys, then its tables and enums - once
--      they're gone there is nothing left in the database that can reference
--      a MANAGER/ENGINEER user.
--   2. Only then delete MANAGER/ENGINEER users. Every SOP table's FK to
--      `users` is onDelete: Restrict (ADR 0006, point 9), so if any SOP row
--      still belongs to one of these users this DELETE fails with a foreign
--      key violation instead of silently succeeding - exactly the "stop
--      rather than delete" safety net ADR 0010 calls for.
--   3. Only then swap `user_role` to the final 7-value set, since the cast in
--      step 3 fails if any row still holds a value being removed.
--
-- Sequences (prj_code_seq/tp_code_seq/pr_code_seq) are left untouched - this
-- migration does not renumber existing Projects/TechPacks/ProtoRequests.

-- Step 1: drop the old module entirely.

ALTER TABLE "approvals" DROP CONSTRAINT "approvals_decided_by_fkey";
ALTER TABLE "approvals" DROP CONSTRAINT "approvals_product_id_fkey";
ALTER TABLE "approvals" DROP CONSTRAINT "approvals_product_version_id_fkey";
ALTER TABLE "approvals" DROP CONSTRAINT "approvals_stage_id_fkey";

ALTER TABLE "product_stage_assignment_history" DROP CONSTRAINT "product_stage_assignment_history_acted_by_fkey";
ALTER TABLE "product_stage_assignment_history" DROP CONSTRAINT "product_stage_assignment_history_product_id_fkey";
ALTER TABLE "product_stage_assignment_history" DROP CONSTRAINT "product_stage_assignment_history_stage_id_fkey";
ALTER TABLE "product_stage_assignment_history" DROP CONSTRAINT "product_stage_assignment_history_user_id_fkey";

ALTER TABLE "product_stage_assignments" DROP CONSTRAINT "product_stage_assignments_assigned_by_fkey";
ALTER TABLE "product_stage_assignments" DROP CONSTRAINT "product_stage_assignments_product_id_fkey";
ALTER TABLE "product_stage_assignments" DROP CONSTRAINT "product_stage_assignments_stage_id_fkey";
ALTER TABLE "product_stage_assignments" DROP CONSTRAINT "product_stage_assignments_user_id_fkey";

ALTER TABLE "product_stage_history" DROP CONSTRAINT "product_stage_history_exited_by_fkey";
ALTER TABLE "product_stage_history" DROP CONSTRAINT "product_stage_history_product_id_fkey";
ALTER TABLE "product_stage_history" DROP CONSTRAINT "product_stage_history_responsible_user_id_fkey";
ALTER TABLE "product_stage_history" DROP CONSTRAINT "product_stage_history_stage_id_fkey";

ALTER TABLE "product_versions" DROP CONSTRAINT "product_versions_created_by_fkey";
ALTER TABLE "product_versions" DROP CONSTRAINT "product_versions_product_id_fkey";

ALTER TABLE "products" DROP CONSTRAINT "products_current_stage_id_fkey";
ALTER TABLE "products" DROP CONSTRAINT "products_owner_id_fkey";

ALTER TABLE "stage_progress_notes" DROP CONSTRAINT "stage_progress_notes_product_id_fkey";
ALTER TABLE "stage_progress_notes" DROP CONSTRAINT "stage_progress_notes_stage_id_fkey";
ALTER TABLE "stage_progress_notes" DROP CONSTRAINT "stage_progress_notes_user_id_fkey";

DROP TABLE "approvals";
DROP TABLE "product_stage_assignment_history";
DROP TABLE "product_stage_assignments";
DROP TABLE "product_stage_history";
DROP TABLE "product_versions";
DROP TABLE "products";
DROP TABLE "stage_definitions";
DROP TABLE "stage_progress_notes";

DROP TYPE "assignment_action";
DROP TYPE "product_status";

-- Step 2: delete the legacy-role users. Fails here (foreign key violation on
-- a users_* FK from projects/tech_packs/tech_pack_versions/tech_pack_remarks/
-- tech_pack_confirmations/tech_pack_approvals/attachments) if a MANAGER or
-- ENGINEER user created any SOP data - that case needs a manual decision
-- (remap or keep), not a silent delete.

DELETE FROM "users" WHERE "role" IN ('MANAGER', 'ENGINEER');

-- Step 3: narrow user_role to its final 7 values.

BEGIN;
CREATE TYPE "user_role_new" AS ENUM ('ADMIN', 'FINANCE', 'PMO', 'PRODUCT_DESIGNER', 'ENGINEERING', 'MANAGEMENT', 'MERCHANDISER');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "user_role_new" USING ("role"::text::"user_role_new");
ALTER TYPE "user_role" RENAME TO "user_role_old";
ALTER TYPE "user_role_new" RENAME TO "user_role";
DROP TYPE "user_role_old";
COMMIT;
