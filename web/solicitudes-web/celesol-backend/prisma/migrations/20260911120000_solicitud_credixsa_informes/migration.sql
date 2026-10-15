-- Informe de CredixSA guardado por solicitud, para que la pestaña lo muestre
-- sin esperar a Kestra. Una fila por solicitud: cada consulta nueva la pisa.
--
-- Se borra cuando la solicitud termina mal (Desestimada, Rechazada, Vencida),
-- en la misma transaccion del cambio de estado. Para las que siguen su curso
-- todavia no hay plazo de conservacion definido.
CREATE TABLE "solicitud_credixsa_informes" (
    "id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "cuit" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "informe" JSONB NOT NULL,
    "consultado_en" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitud_credixsa_informes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_credixsa_informes_solicitud_id_key" ON "solicitud_credixsa_informes"("solicitud_id");

-- AddForeignKey
ALTER TABLE "solicitud_credixsa_informes" ADD CONSTRAINT "solicitud_credixsa_informes_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
