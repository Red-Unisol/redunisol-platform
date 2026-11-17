-- Versiones de la calculadora de riesgo. Riesgo trae la ultima SCORINGPF de
-- Vimarx con un boton; el backend la adapta y la guarda aca (pesa ~50 KB).
-- Una sola vigente; quedan la vigente y las 3 anteriores. Volver atras crea
-- una fila nueva con origen RESTAURADA que apunta a la version copiada, asi
-- el historial dice quien volvio y a cual (restaurada_de_id no es FK: la
-- copiada puede borrarse al rotar). Sin filas, la calculadora usa el archivo
-- docs/calculadora-riesgo/CALCULADORA MUTUAL.xlsx como hasta ahora; la primera
-- actualizacion lo guarda como version REPOSITORIO para poder volver a el.
CREATE TYPE "CalculadoraRiesgoOrigen" AS ENUM ('REPOSITORIO', 'VIMARX', 'RESTAURADA');

CREATE TABLE "calculadora_riesgo_versiones" (
    "id" UUID NOT NULL,
    "contenido" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "origen" "CalculadoraRiesgoOrigen" NOT NULL,
    "restaurada_de_id" UUID,
    "resumen_cambios" JSONB,
    "vigente" BOOLEAN NOT NULL DEFAULT false,
    "cargada_por_id" UUID,
    "cargada_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calculadora_riesgo_versiones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "calculadora_riesgo_versiones_cargada_en_idx" ON "calculadora_riesgo_versiones"("cargada_en");

-- Nunca dos vigentes a la vez (Prisma no expresa indices parciales).
CREATE UNIQUE INDEX "calculadora_riesgo_versiones_una_vigente" ON "calculadora_riesgo_versiones"("vigente") WHERE "vigente";

ALTER TABLE "calculadora_riesgo_versiones" ADD CONSTRAINT "calculadora_riesgo_versiones_cargada_por_id_fkey" FOREIGN KEY ("cargada_por_id") REFERENCES "users"("usr_id") ON DELETE SET NULL ON UPDATE CASCADE;
