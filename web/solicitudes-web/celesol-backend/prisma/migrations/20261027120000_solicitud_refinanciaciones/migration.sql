-- CreateTable
CREATE TABLE "solicitud_refinanciaciones" (
    "id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "prestamo_legacy_id" TEXT NOT NULL,
    "nros_cuota" INTEGER[],
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitud_refinanciaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_refinanciaciones_solicitud_id_prestamo_legacy_id_key" ON "solicitud_refinanciaciones"("solicitud_id", "prestamo_legacy_id");

-- AddForeignKey
ALTER TABLE "solicitud_refinanciaciones" ADD CONSTRAINT "solicitud_refinanciaciones_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
