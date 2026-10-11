ALTER TABLE "solicitud_estado_historial" ADD COLUMN "real_actor_user_id" UUID,
 ADD COLUMN "impersonation_session_id" UUID, ADD COLUMN "operation_audit_id" UUID;
CREATE TABLE "impersonation_sessions" (
 "id" UUID PRIMARY KEY, "administrator_id" UUID NOT NULL, "selected_user_id" UUID NOT NULL,
 "administrator_label" TEXT NOT NULL, "selected_user_label" TEXT NOT NULL,
 "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expires_at" TIMESTAMP(3) NOT NULL, "ended_at" TIMESTAMP(3), "end_reason" TEXT
);
CREATE INDEX "impersonation_sessions_administrator_id_idx" ON "impersonation_sessions"("administrator_id");
CREATE TABLE "impersonation_operations" (
 "id" UUID PRIMARY KEY, "session_id" UUID NOT NULL, "administrator_id" UUID NOT NULL,
 "selected_user_id" UUID NOT NULL, "action" TEXT NOT NULL,
 "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completed_at" TIMESTAMP(3), "status_code" INTEGER
);
CREATE INDEX "impersonation_operations_session_id_started_at_idx" ON "impersonation_operations"("session_id", "started_at");
