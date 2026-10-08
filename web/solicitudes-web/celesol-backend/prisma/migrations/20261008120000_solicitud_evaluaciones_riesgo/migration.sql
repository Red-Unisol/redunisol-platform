-- Calculadora de riesgo guardada por solicitud (pestaña Evaluacion). La
-- planilla va al almacenamiento de archivos (MinIO en dev, S3 en prod) en
-- "evaluaciones/<solicitud_id>.json"; aca queda la referencia, el nivel de
-- riesgo (Evaluacion!D30, 1 a 5) y quien la guardo. Una fila por solicitud:
-- cada guardado la pisa, igual que el Evaluacion1.xlsx del legado.
CREATE TABLE "solicitud_evaluaciones_riesgo" (
    "id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "storage_bucket" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "nivel_riesgo" INTEGER,
    "guardada_por_id" UUID,
    "guardada_en" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitud_evaluaciones_riesgo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_evaluaciones_riesgo_solicitud_id_key" ON "solicitud_evaluaciones_riesgo"("solicitud_id");

-- AddForeignKey
ALTER TABLE "solicitud_evaluaciones_riesgo" ADD CONSTRAINT "solicitud_evaluaciones_riesgo_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_evaluaciones_riesgo" ADD CONSTRAINT "solicitud_evaluaciones_riesgo_guardada_por_id_fkey" FOREIGN KEY ("guardada_por_id") REFERENCES "users"("usr_id") ON DELETE SET NULL ON UPDATE CASCADE;
