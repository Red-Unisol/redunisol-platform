-- Keep the physical PostgreSQL constraints aligned with the Prisma model.
-- PostgreSQL truncated the original 65-character unique index name to 63.
BEGIN;
ALTER TABLE "solicitud_prestamo_replacements" DROP CONSTRAINT "solicitud_prestamo_replacements_solicitud_id_fkey";
ALTER TABLE "solicitud_prestamo_replacements" ADD CONSTRAINT "solicitud_prestamo_replacements_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER INDEX "solicitud_prestamo_replacements_solicitud_id_previous_loan_id_k" RENAME TO "solicitud_prestamo_replacements_solicitud_id_previous_loan__key";
COMMIT;
