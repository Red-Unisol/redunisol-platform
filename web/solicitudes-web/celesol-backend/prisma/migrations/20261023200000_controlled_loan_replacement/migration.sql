CREATE TABLE "solicitud_prestamo_replacements" (
 "id" UUID PRIMARY KEY, "solicitud_id" UUID NOT NULL REFERENCES "solicitudes"("id") ON DELETE RESTRICT,
 "previous_loan_id" TEXT NOT NULL, "new_loan_id" TEXT, "status" TEXT NOT NULL,
 "reason" TEXT NOT NULL, "actor_id" UUID NOT NULL, "previous_snapshot" JSONB NOT NULL,
 "intended_input" JSONB NOT NULL, "source_fingerprint" TEXT NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 "completed_at" TIMESTAMP(3),
 CONSTRAINT "replacement_status_valid" CHECK ("status" IN ('CREATING','UNCERTAIN','CREATED','LINKED'))
);
CREATE UNIQUE INDEX "solicitud_prestamo_replacements_new_loan_id_key" ON "solicitud_prestamo_replacements"("new_loan_id");
CREATE UNIQUE INDEX "solicitud_prestamo_replacements_solicitud_id_previous_loan_id_key" ON "solicitud_prestamo_replacements"("solicitud_id","previous_loan_id");
