-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'MANAGER', 'ENGINEER', 'FINANCE');

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('ON_TRACK', 'DELAYED', 'BLOCKED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_definitions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sequence_order" INTEGER NOT NULL,
    "expected_duration_days" INTEGER NOT NULL,

    CONSTRAINT "stage_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_id" UUID NOT NULL,
    "current_stage_id" UUID,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "status" "product_status" NOT NULL DEFAULT 'ON_TRACK',
    "start_date" TIMESTAMP(3),
    "expected_completion_date" TIMESTAMP(3),
    "actual_completion_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_versions" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "spec" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "product_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_stage_history" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exited_at" TIMESTAMP(3),
    "actual_duration_days" INTEGER,
    "delayed" BOOLEAN NOT NULL DEFAULT false,
    "delay_reason" TEXT,
    "responsible_user_id" UUID,

    CONSTRAINT "product_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "stage_definitions_sequence_order_key" ON "stage_definitions"("sequence_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_versions_product_id_version_number_key" ON "product_versions"("product_id", "version_number");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_current_stage_id_fkey" FOREIGN KEY ("current_stage_id") REFERENCES "stage_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_history" ADD CONSTRAINT "product_stage_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_history" ADD CONSTRAINT "product_stage_history_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "stage_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_history" ADD CONSTRAINT "product_stage_history_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
