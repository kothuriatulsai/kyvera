-- CreateEnum
CREATE TYPE "assignment_action" AS ENUM ('ASSIGNED', 'UNASSIGNED');

-- AlterTable
ALTER TABLE "product_stage_history" ADD COLUMN     "exited_by" UUID,
ADD COLUMN     "forced_exit" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "product_stage_assignments" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID NOT NULL,
    "ready_at" TIMESTAMP(3),

    CONSTRAINT "product_stage_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_stage_assignment_history" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" "assignment_action" NOT NULL,
    "acted_by" UUID NOT NULL,
    "acted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_stage_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_progress_notes" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_progress_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_stage_assignments_user_id_idx" ON "product_stage_assignments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_stage_assignments_product_id_stage_id_user_id_key" ON "product_stage_assignments"("product_id", "stage_id", "user_id");

-- CreateIndex
CREATE INDEX "product_stage_assignment_history_product_id_idx" ON "product_stage_assignment_history"("product_id");

-- CreateIndex
CREATE INDEX "stage_progress_notes_product_id_stage_id_idx" ON "stage_progress_notes"("product_id", "stage_id");

-- AddForeignKey
ALTER TABLE "product_stage_history" ADD CONSTRAINT "product_stage_history_exited_by_fkey" FOREIGN KEY ("exited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_assignments" ADD CONSTRAINT "product_stage_assignments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_assignments" ADD CONSTRAINT "product_stage_assignments_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "stage_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_assignments" ADD CONSTRAINT "product_stage_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_assignments" ADD CONSTRAINT "product_stage_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_assignment_history" ADD CONSTRAINT "product_stage_assignment_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_assignment_history" ADD CONSTRAINT "product_stage_assignment_history_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "stage_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_assignment_history" ADD CONSTRAINT "product_stage_assignment_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_assignment_history" ADD CONSTRAINT "product_stage_assignment_history_acted_by_fkey" FOREIGN KEY ("acted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_progress_notes" ADD CONSTRAINT "stage_progress_notes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_progress_notes" ADD CONSTRAINT "stage_progress_notes_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "stage_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_progress_notes" ADD CONSTRAINT "stage_progress_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
