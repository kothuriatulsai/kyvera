-- CreateEnum
CREATE TYPE "proto_work_status" AS ENUM ('QUEUED', 'ASSIGNED', 'COMPLETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type" ADD VALUE 'MANUFACTURER_ASSIGNED';
ALTER TYPE "notification_type" ADD VALUE 'PROTO_REQUEST_PO_UPLOADED';
ALTER TYPE "notification_type" ADD VALUE 'PROTO_WORK_QUEUED';
ALTER TYPE "notification_type" ADD VALUE 'PROTO_WORK_ASSIGNED';
ALTER TYPE "notification_type" ADD VALUE 'PROTO_WORK_COMPLETED';

-- Hand-edited (ADR 0006/0015): the new per-prefix sequence must exist before
-- the ProtoWork.code column default below references it. format_code()
-- itself already exists (Slice A's migration) - only the sequence is new.
CREATE SEQUENCE "pw_code_seq";

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "proto_request_id" UUID;

-- AlterTable
ALTER TABLE "proto_requests" ADD COLUMN     "agreed_delivery_date" DATE,
ADD COLUMN     "commercial_notes" TEXT,
ADD COLUMN     "confirmation_note" TEXT,
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "confirmed_by" UUID,
ADD COLUMN     "manufacturer_assigned_at" TIMESTAMP(3),
ADD COLUMN     "manufacturer_assigned_by" UUID,
ADD COLUMN     "manufacturer_id" UUID;

-- CreateTable
CREATE TABLE "manufacturer_masters" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manufacturer_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proto_work" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL DEFAULT format_code('PW'::text, nextval('pw_code_seq'::regclass)),
    "project_id" UUID NOT NULL,
    "proto_request_id" UUID NOT NULL,
    "status" "proto_work_status" NOT NULL DEFAULT 'QUEUED',
    "assigned_merchandiser_id" UUID,
    "assigned_at" TIMESTAMP(3),
    "assigned_by" UUID,
    "current_delivery_date" DATE NOT NULL,
    "completed_at" TIMESTAMP(3),
    "completed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proto_work_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proto_work_delivery_confirmations" (
    "id" UUID NOT NULL,
    "proto_work_id" UUID NOT NULL,
    "delivery_date" DATE NOT NULL,
    "confirmed_by" UUID NOT NULL,
    "notes" TEXT,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proto_work_delivery_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proto_work_updates" (
    "id" UUID NOT NULL,
    "proto_work_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proto_work_updates_pkey" PRIMARY KEY ("id")
);

-- Hand-edited (ADR 0006/0015): tie the new sequence's lifetime to the column
-- it generates codes for, same reasoning as every existing *_code_seq - so
-- TRUNCATE ... RESTART IDENTITY resets it and dropping the table drops it
-- rather than leaving it orphaned.
ALTER SEQUENCE "pw_code_seq" OWNED BY "proto_work"."code";

-- CreateIndex
CREATE UNIQUE INDEX "proto_work_code_key" ON "proto_work"("code");

-- CreateIndex
CREATE UNIQUE INDEX "proto_work_proto_request_id_key" ON "proto_work"("proto_request_id");

-- CreateIndex
CREATE INDEX "proto_work_project_id_idx" ON "proto_work"("project_id");

-- CreateIndex
CREATE INDEX "proto_work_delivery_confirmations_proto_work_id_idx" ON "proto_work_delivery_confirmations"("proto_work_id");

-- CreateIndex
CREATE INDEX "proto_work_updates_proto_work_id_idx" ON "proto_work_updates"("proto_work_id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_proto_request_id_key" ON "attachments"("proto_request_id");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_proto_request_id_fkey" FOREIGN KEY ("proto_request_id") REFERENCES "proto_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_requests" ADD CONSTRAINT "proto_requests_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "manufacturer_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_requests" ADD CONSTRAINT "proto_requests_manufacturer_assigned_by_fkey" FOREIGN KEY ("manufacturer_assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_requests" ADD CONSTRAINT "proto_requests_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturer_masters" ADD CONSTRAINT "manufacturer_masters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_work" ADD CONSTRAINT "proto_work_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_work" ADD CONSTRAINT "proto_work_proto_request_id_fkey" FOREIGN KEY ("proto_request_id") REFERENCES "proto_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_work" ADD CONSTRAINT "proto_work_assigned_merchandiser_id_fkey" FOREIGN KEY ("assigned_merchandiser_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_work" ADD CONSTRAINT "proto_work_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_work" ADD CONSTRAINT "proto_work_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_work_delivery_confirmations" ADD CONSTRAINT "proto_work_delivery_confirmations_proto_work_id_fkey" FOREIGN KEY ("proto_work_id") REFERENCES "proto_work"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_work_delivery_confirmations" ADD CONSTRAINT "proto_work_delivery_confirmations_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_work_updates" ADD CONSTRAINT "proto_work_updates_proto_work_id_fkey" FOREIGN KEY ("proto_work_id") REFERENCES "proto_work"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proto_work_updates" ADD CONSTRAINT "proto_work_updates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
