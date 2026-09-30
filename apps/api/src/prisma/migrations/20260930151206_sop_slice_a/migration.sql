-- Hand-edited (ADR 0006): the per-prefix code-formatting function and its
-- backing sequences must exist before any column default below references
-- them. GREATEST(6, length(n::text)) is deliberate - plain lpad(n::text, 6,
-- '0') truncates (from the left) once n has more than 6 digits, silently
-- dropping the leading digit past 999999. This grows the pad width with the
-- number instead, so lpad only ever pads, never truncates.
CREATE OR REPLACE FUNCTION format_code(prefix text, n bigint) RETURNS text AS $$
  SELECT prefix || '-' || lpad(n::text, GREATEST(6, length(n::text)), '0');
$$ LANGUAGE sql IMMUTABLE;

CREATE SEQUENCE "prj_code_seq";
CREATE SEQUENCE "tp_code_seq";
CREATE SEQUENCE "pr_code_seq";

-- CreateEnum
CREATE TYPE "project_phase" AS ENUM ('PROTO', 'BULK');

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('ACTIVE', 'COMPLETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "user_role" ADD VALUE 'PMO';
ALTER TYPE "user_role" ADD VALUE 'PRODUCT_DESIGNER';
ALTER TYPE "user_role" ADD VALUE 'ENGINEERING';
ALTER TYPE "user_role" ADD VALUE 'MANAGEMENT';
ALTER TYPE "user_role" ADD VALUE 'MERCHANDISER';

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL DEFAULT format_code('PRJ', nextval('prj_code_seq')),
    "name" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "product_category" TEXT,
    "phase" "project_phase" NOT NULL DEFAULT 'PROTO',
    "status" "project_status" NOT NULL DEFAULT 'ACTIVE',
    "proto_completed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tech_packs" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL DEFAULT format_code('TP', nextval('tp_code_seq')),
    "project_id" UUID NOT NULL,
    "phase" "project_phase" NOT NULL DEFAULT 'PROTO',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by" UUID,
    "void_reason" TEXT,
    "supersedes_id" UUID,

    CONSTRAINT "tech_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tech_pack_versions" (
    "id" UUID NOT NULL,
    "tech_pack_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "notes" TEXT,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tech_pack_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tech_pack_version_id" UUID,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tech_pack_remarks" (
    "id" UUID NOT NULL,
    "tech_pack_version_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tech_pack_remarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tech_pack_confirmations" (
    "id" UUID NOT NULL,
    "tech_pack_version_id" UUID NOT NULL,
    "confirmed_by" UUID NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tech_pack_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tech_pack_approvals" (
    "id" UUID NOT NULL,
    "tech_pack_version_id" UUID NOT NULL,
    "decision" "approval_decision" NOT NULL,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "tech_pack_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proto_requests" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL DEFAULT format_code('PR', nextval('pr_code_seq')),
    "project_id" UUID NOT NULL,
    "tech_pack_version_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proto_requests_pkey" PRIMARY KEY ("id")
);

-- Hand-edited (ADR 0006): tie each sequence's lifetime to the column it
-- generates codes for. OWNED BY makes TRUNCATE ... RESTART IDENTITY reset the
-- sequence (so tests that truncate between runs get PRJ-000001 again instead
-- of continuing an old count), and makes dropping the table drop the
-- sequence with it instead of leaving it orphaned.
ALTER SEQUENCE "prj_code_seq" OWNED BY "projects"."code";
ALTER SEQUENCE "tp_code_seq" OWNED BY "tech_packs"."code";
ALTER SEQUENCE "pr_code_seq" OWNED BY "proto_requests"."code";

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tech_packs_code_key" ON "tech_packs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tech_packs_supersedes_id_key" ON "tech_packs"("supersedes_id");

-- CreateIndex
CREATE INDEX "tech_packs_project_id_idx" ON "tech_packs"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "tech_pack_versions_tech_pack_id_version_number_key" ON "tech_pack_versions"("tech_pack_id", "version_number");

-- CreateIndex
CREATE INDEX "attachments_tech_pack_version_id_idx" ON "attachments"("tech_pack_version_id");

-- CreateIndex
CREATE INDEX "tech_pack_remarks_tech_pack_version_id_idx" ON "tech_pack_remarks"("tech_pack_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "tech_pack_confirmations_tech_pack_version_id_key" ON "tech_pack_confirmations"("tech_pack_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "tech_pack_approvals_tech_pack_version_id_key" ON "tech_pack_approvals"("tech_pack_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "proto_requests_code_key" ON "proto_requests"("code");

-- CreateIndex
CREATE INDEX "proto_requests_project_id_tech_pack_version_id_idx" ON "proto_requests"("project_id", "tech_pack_version_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_packs" ADD CONSTRAINT "tech_packs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_packs" ADD CONSTRAINT "tech_packs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_packs" ADD CONSTRAINT "tech_packs_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_packs" ADD CONSTRAINT "tech_packs_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "tech_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_pack_versions" ADD CONSTRAINT "tech_pack_versions_tech_pack_id_fkey" FOREIGN KEY ("tech_pack_id") REFERENCES "tech_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_pack_versions" ADD CONSTRAINT "tech_pack_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tech_pack_version_id_fkey" FOREIGN KEY ("tech_pack_version_id") REFERENCES "tech_pack_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_pack_remarks" ADD CONSTRAINT "tech_pack_remarks_tech_pack_version_id_fkey" FOREIGN KEY ("tech_pack_version_id") REFERENCES "tech_pack_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_pack_remarks" ADD CONSTRAINT "tech_pack_remarks_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_pack_confirmations" ADD CONSTRAINT "tech_pack_confirmations_tech_pack_version_id_fkey" FOREIGN KEY ("tech_pack_version_id") REFERENCES "tech_pack_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_pack_confirmations" ADD CONSTRAINT "tech_pack_confirmations_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_pack_approvals" ADD CONSTRAINT "tech_pack_approvals_tech_pack_version_id_fkey" FOREIGN KEY ("tech_pack_version_id") REFERENCES "tech_pack_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_pack_approvals" ADD CONSTRAINT "tech_pack_approvals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_requests" ADD CONSTRAINT "proto_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_requests" ADD CONSTRAINT "proto_requests_tech_pack_version_id_fkey" FOREIGN KEY ("tech_pack_version_id") REFERENCES "tech_pack_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
