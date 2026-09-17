-- DropForeignKey
ALTER TABLE "product_stage_history" DROP CONSTRAINT "product_stage_history_product_id_fkey";

-- DropForeignKey
ALTER TABLE "product_versions" DROP CONSTRAINT "product_versions_product_id_fkey";

-- AddForeignKey
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_history" ADD CONSTRAINT "product_stage_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
