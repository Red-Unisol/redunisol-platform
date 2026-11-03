ALTER TABLE "solicitudes" ADD COLUMN "desestimacion_historial_id" UUID;

-- Every active state except Desestimada can be dismissed. Existing configured
-- labels/comments keep their values; a reason is mandatory for every origin.
INSERT INTO "workflow_transitions" (
  "id", "from_state_id", "to_state_id", "action_code", "action_label",
  "sort_order", "requires_comment", "is_active", "updated_at"
)
SELECT gen_random_uuid(), source.id, target.id, 'desestimar', 'Desestimar',
  100, true, true, CURRENT_TIMESTAMP
FROM workflow_states source CROSS JOIN workflow_states target
WHERE source.is_active AND source.code <> 'Desestimada' AND target.code = 'Desestimada'
ON CONFLICT ("from_state_id", "action_code") DO UPDATE
SET "to_state_id" = EXCLUDED."to_state_id", "requires_comment" = true,
    "is_active" = true, "updated_at" = CURRENT_TIMESTAMP;

-- Backfill only an unambiguous last state-changing event. Missing or tied
-- historical evidence must never become a guessed restoration destination.
WITH latest AS (
  SELECT h.*, max(h.changed_at) OVER (PARTITION BY h.solicitud_id) AS last_at
  FROM solicitud_estado_historial h
  WHERE h.estado_anterior_id IS DISTINCT FROM h.estado_nuevo_id
), candidates AS (
  SELECT solicitud_id, min(id::text)::uuid AS id
  FROM latest
  WHERE changed_at = last_at
  GROUP BY solicitud_id HAVING count(*) = 1
)
UPDATE solicitudes s SET desestimacion_historial_id = h.id
FROM candidates c JOIN solicitud_estado_historial h ON h.id = c.id
JOIN workflow_states dest ON dest.id = h.estado_nuevo_id
JOIN workflow_states prev ON prev.id = h.estado_anterior_id
WHERE s.id = c.solicitud_id AND s.estado_actual_id = dest.id
  AND dest.code = 'Desestimada' AND prev.code <> 'Desestimada'
  AND h.action_code = 'desestimar';
