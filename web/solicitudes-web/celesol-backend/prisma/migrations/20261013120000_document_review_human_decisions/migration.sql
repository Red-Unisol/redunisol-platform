CREATE TABLE "solicitud_document_reviews" (
 "id" UUID NOT NULL, "solicitud_id" UUID NOT NULL,
 "evaluation_key" TEXT NOT NULL, "policy_version" TEXT NOT NULL,
 "source_fingerprint" TEXT NOT NULL, "provider_fingerprint" TEXT NOT NULL,
 "source_snapshot" JSONB NOT NULL, "assessment" JSONB NOT NULL,
 "system_decision" TEXT NOT NULL CHECK ("system_decision" IN ('approve','not_approve')),
 "selected_verification_id" TEXT, "evidence_path" TEXT, "legajo_adjunto_id" UUID,
 "artifact_error" TEXT, "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "solicitud_document_reviews_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "solicitud_document_reviews_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "solicitud_document_reviews_legajo_fkey" FOREIGN KEY ("legajo_adjunto_id") REFERENCES "solicitud_adjuntos"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "solicitud_document_reviews_evaluation_key_key" ON "solicitud_document_reviews"("evaluation_key");
CREATE INDEX "solicitud_document_reviews_solicitud_id_evaluated_at_idx" ON "solicitud_document_reviews"("solicitud_id","evaluated_at");
CREATE INDEX "document_review_fingerprint_idx" ON "solicitud_document_reviews"("solicitud_id","source_fingerprint","provider_fingerprint");

CREATE TABLE "solicitud_document_decisions" (
 "id" UUID NOT NULL, "review_id" UUID NOT NULL, "request_id" UUID NOT NULL,
 "human_decision" TEXT NOT NULL CHECK ("human_decision" IN ('approve','not_approve')),
 "system_decision" TEXT NOT NULL CHECK ("system_decision" IN ('approve','not_approve')),
 "verification_id" TEXT, "attempt_system_decision" TEXT,
 "disagrees_with_system" BOOLEAN NOT NULL, "overrides_attempt" BOOLEAN NOT NULL,
 "reason" TEXT NOT NULL, "decided_by" UUID NOT NULL, "actor_name" TEXT NOT NULL,
 "acting_audit" JSONB NOT NULL, "legajo_adjunto_id" UUID,
 "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "solicitud_document_decisions_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "solicitud_document_decisions_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "solicitud_document_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "solicitud_document_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("usr_id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "solicitud_document_decisions_legajo_fkey" FOREIGN KEY ("legajo_adjunto_id") REFERENCES "solicitud_adjuntos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "solicitud_document_decisions_reason_check" CHECK (("human_decision"='approve' AND NOT "disagrees_with_system" AND NOT "overrides_attempt") OR length(trim("reason")) > 0)
);
CREATE UNIQUE INDEX "solicitud_document_decisions_request_id_key" ON "solicitud_document_decisions"("request_id");
CREATE INDEX "solicitud_document_decisions_review_id_decided_at_idx" ON "solicitud_document_decisions"("review_id","decided_at");
CREATE INDEX "document_decision_disparity_idx" ON "solicitud_document_decisions"("disagrees_with_system","decided_at");

CREATE TABLE "solicitud_document_review_jobs" (
 "solicitud_id" UUID NOT NULL, "lease_token" UUID, "lease_until" TIMESTAMP(3),
 "next_check_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "solicitud_document_review_jobs_pkey" PRIMARY KEY ("solicitud_id"),
 CONSTRAINT "solicitud_document_review_jobs_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "solicitud_document_review_jobs_next_check_at_idx" ON "solicitud_document_review_jobs"("next_check_at");

-- Preserve the comparison cohort even when attachments are edited in the UI.
CREATE FUNCTION beex_document_review_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'BEEX_DOCUMENT_REVIEW_IMMUTABLE'; END; $$;
CREATE TRIGGER document_review_append_only BEFORE UPDATE OR DELETE ON solicitud_document_reviews FOR EACH ROW EXECUTE FUNCTION beex_document_review_append_only();
CREATE TRIGGER document_decision_append_only BEFORE UPDATE OR DELETE ON solicitud_document_decisions FOR EACH ROW EXECUTE FUNCTION beex_document_review_append_only();

CREATE FUNCTION beex_document_legajo_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM solicitud_document_reviews WHERE legajo_adjunto_id=OLD.id)
 OR EXISTS (SELECT 1 FROM solicitud_document_decisions WHERE legajo_adjunto_id=OLD.id) THEN
  RAISE EXCEPTION 'BEEX_DOCUMENT_REVIEW_IMMUTABLE';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER document_legajo_immutable BEFORE UPDATE OR DELETE ON solicitud_adjuntos FOR EACH ROW EXECUTE FUNCTION beex_document_legajo_immutable();
