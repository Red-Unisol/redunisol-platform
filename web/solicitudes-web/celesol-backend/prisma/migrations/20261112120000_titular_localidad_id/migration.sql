-- ID de la localidad de Vimarx (ClasesBase.Localidad) elegida para el titular.
-- Es el dato: "localidad" queda como el nombre que el backend copia de Vimarx
-- para mostrar e imprimir. Las solicitudes anteriores quedan con NULL: solo
-- tienen el nombre y un nombre no identifica una localidad (VILLA MARIA tiene 5).
ALTER TABLE "solicitud_titulares" ADD COLUMN "localidad_id" TEXT;
