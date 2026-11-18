-- Clave que el frontend genera por cada alta de solicitud y repite si
-- reintenta. Con el indice unico, el mismo alta que llega dos veces (doble
-- clic, o reintento despues de un corte por timeout) devuelve la solicitud ya
-- creada en lugar de crear otra igual. Las solicitudes anteriores quedan con
-- NULL; el indice unico admite varios NULL.
ALTER TABLE "solicitudes" ADD COLUMN "idempotency_key" UUID;

CREATE UNIQUE INDEX "solicitudes_idempotency_key_key" ON "solicitudes"("idempotency_key");
