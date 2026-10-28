ALTER TABLE solicitudes
  ADD COLUMN analisis_finalizado_at TIMESTAMP(3),
  ADD COLUMN analisis_finalizado_by UUID,
  ADD COLUMN signature_cycle_id TEXT,
  ADD COLUMN signature_requested_at TIMESTAMP(3),
  ADD COLUMN signature_request_reason TEXT,
  ADD COLUMN signature_excluded_verification_ids JSONB;

-- Preserve the fingerprint of existing observations and approvals. New cases
-- use a loan-specific stable cycle, independent from changes of workflow state.
UPDATE solicitudes s SET signature_cycle_id = COALESCE(
  (SELECT r.source_snapshot->>'cycleId' FROM solicitud_document_reviews r
   WHERE r.solicitud_id=s.id AND r.source_snapshot->>'prestamoId'=s.legacy_oid
   ORDER BY r.evaluated_at DESC, r.id DESC LIMIT 1),
  s.legacy_oid || ':initial'
) WHERE s.legacy_oid IS NOT NULL;

CREATE INDEX solicitudes_signature_pending_idx ON solicitudes (updated_at, id)
  WHERE legacy_oid IS NOT NULL AND archived_at IS NULL;
