-- CreateEnum
CREATE TYPE "project_member_action" AS ENUM ('ADDED', 'REMOVED');

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "added_by" UUID NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_member_history" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" "project_member_action" NOT NULL,
    "by" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_member_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "project_member_history_project_id_idx" ON "project_member_history"("project_id");

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member_history" ADD CONSTRAINT "project_member_history_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member_history" ADD CONSTRAINT "project_member_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member_history" ADD CONSTRAINT "project_member_history_by_fkey" FOREIGN KEY ("by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-edited (ADR 0013): without this backfill, every existing Project
-- would suddenly become invisible to everyone but ADMIN/PMO/MANAGEMENT the
-- moment this migration runs - including the very people who did the actual
-- work on it. For each Project, add its creator plus everyone who uploaded a
-- version, left a remark, confirmed, or decided on one of its Tech Packs.
-- History rows are attributed to the Project's own creator ("by"), not to
-- each added user themselves - there was no real "who added whom" event to
-- record; the creator is the closest honest approximation of one.
INSERT INTO "project_members" ("id", "project_id", "user_id", "added_by", "added_at")
SELECT gen_random_uuid(), p.id, touched.user_id, p.created_by, p.created_at
FROM "projects" p
CROSS JOIN LATERAL (
    SELECT p.created_by AS user_id
    UNION
    SELECT tpv.uploaded_by
    FROM "tech_pack_versions" tpv
    JOIN "tech_packs" tp ON tp.id = tpv.tech_pack_id
    WHERE tp.project_id = p.id
    UNION
    SELECT tpr.author_id
    FROM "tech_pack_remarks" tpr
    JOIN "tech_pack_versions" tpv ON tpv.id = tpr.tech_pack_version_id
    JOIN "tech_packs" tp ON tp.id = tpv.tech_pack_id
    WHERE tp.project_id = p.id
    UNION
    SELECT tpc.confirmed_by
    FROM "tech_pack_confirmations" tpc
    JOIN "tech_pack_versions" tpv ON tpv.id = tpc.tech_pack_version_id
    JOIN "tech_packs" tp ON tp.id = tpv.tech_pack_id
    WHERE tp.project_id = p.id
    UNION
    SELECT tpa.decided_by
    FROM "tech_pack_approvals" tpa
    JOIN "tech_pack_versions" tpv ON tpv.id = tpa.tech_pack_version_id
    JOIN "tech_packs" tp ON tp.id = tpv.tech_pack_id
    WHERE tp.project_id = p.id
) touched;

INSERT INTO "project_member_history" ("id", "project_id", "user_id", "action", "by", "at")
SELECT gen_random_uuid(), pm.project_id, pm.user_id, 'ADDED', pm.added_by, pm.added_at
FROM "project_members" pm;
