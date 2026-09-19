-- CreateEnum
CREATE TYPE "approval_decision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_version_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "decision" "approval_decision" NOT NULL,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approvals_product_id_product_version_id_idx" ON "approvals"("product_id", "product_version_id");

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_product_version_id_fkey" FOREIGN KEY ("product_version_id") REFERENCES "product_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "stage_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
