CREATE TABLE "technical_diagnostic_events" (
  "id" BIGSERIAL NOT NULL,
  "operation_id" UUID NOT NULL,
  "solicitud_id" UUID,
  "actor_id" UUID,
  "real_actor_id" UUID,
  "operation" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "call_id" UUID,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "elapsed_ms" INTEGER,
  "data" JSONB NOT NULL,
  CONSTRAINT "technical_diagnostic_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "technical_diagnostic_event_elapsed_check" CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0)
);
CREATE INDEX "technical_diagnostic_events_operation_id_id_idx" ON "technical_diagnostic_events" ("operation_id", "id");
CREATE INDEX "technical_diagnostic_events_solicitud_id_id_idx" ON "technical_diagnostic_events" ("solicitud_id", "id");
CREATE INDEX "technical_diagnostic_events_recorded_at_idx" ON "technical_diagnostic_events" ("recorded_at");

CREATE FUNCTION beex_technical_diagnostic_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'BEEX_TECHNICAL_DIAGNOSTIC_IMMUTABLE'; END; $$;
CREATE TRIGGER technical_diagnostic_append_only BEFORE UPDATE OR DELETE ON technical_diagnostic_events
FOR EACH ROW EXECUTE FUNCTION beex_technical_diagnostic_append_only();
CREATE TRIGGER technical_diagnostic_no_truncate BEFORE TRUNCATE ON technical_diagnostic_events
FOR EACH STATEMENT EXECUTE FUNCTION beex_technical_diagnostic_append_only();
