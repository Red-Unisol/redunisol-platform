-- Fecha de calculo de la refinanciacion (null = el dia del cobro)
ALTER TABLE "solicitud_refinanciaciones" ADD COLUMN "fecha_calculo" DATE;
