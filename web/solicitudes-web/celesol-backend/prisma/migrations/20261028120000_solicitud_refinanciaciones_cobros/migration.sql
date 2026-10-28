-- Uno o dos cobros por prestamo (las vencidas aparte, con punitorios): la
-- lista reemplaza a las tres columnas de un solo cobro.
ALTER TABLE "solicitud_refinanciaciones" ADD COLUMN "cobros" JSONB NOT NULL DEFAULT '[]';

-- Lo ya cobrado pasa a la lista, con todas las cuotas del prestamo.
UPDATE "solicitud_refinanciaciones"
SET "cobros" = jsonb_build_array(jsonb_build_object(
    'cobroId', "cobro_legacy_id",
    'totalCobrado', "total_cobrado",
    'nrosCuota', to_jsonb("nros_cuota"),
    'cobradoAt', to_char("cobrado_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
))
WHERE "cobro_legacy_id" IS NOT NULL;

-- AlterTable
ALTER TABLE "solicitud_refinanciaciones" DROP COLUMN "cobrado_at",
DROP COLUMN "cobro_legacy_id",
DROP COLUMN "total_cobrado";
