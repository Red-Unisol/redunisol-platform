-- AlterTable
ALTER TABLE "solicitud_refinanciaciones" ADD COLUMN     "cobrado_at" TIMESTAMP(3),
ADD COLUMN     "cobro_legacy_id" TEXT,
ADD COLUMN     "total_cobrado" DECIMAL(18,2);

