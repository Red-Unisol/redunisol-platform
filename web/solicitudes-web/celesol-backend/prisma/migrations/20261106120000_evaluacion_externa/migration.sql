BEGIN;

-- External consultation remains owned by Riesgo, with its own history interval.
INSERT INTO "workflow_states" (
  "id", "owner_id", "code", "name", "description",
  "is_initial", "is_terminal", "is_active", "created_at", "updated_at"
)
SELECT gen_random_uuid(), owner."id", 'EvaluacionExterna', 'Evaluación Externa',
  'Espera de confirmación de datos por otra persona; tiempo separado del análisis de Riesgo.',
  false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "workflow_owners" owner WHERE owner."code" = 'RIESGO';

INSERT INTO "workflow_transitions" (
  "id", "from_state_id", "to_state_id", "action_code", "action_label",
  "default_comment", "sort_order", "save_and_exit", "requires_comment",
  "is_active", "created_at", "updated_at"
)
SELECT gen_random_uuid(), origin."id", target."id", route.action_code, route.action_label,
  route.default_comment, route.sort_order, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('RevisionRiesgo', 'evaluacion_externa', 'Enviar a Evaluación Externa', 'EvaluacionExterna', 'Evaluación externa solicitada', 50),
  ('EvaluacionExterna', 'volver_a_revision_riesgo', 'Volver a Revisión Riesgo', 'RevisionRiesgo', 'Evaluación externa finalizada', 10)
) AS route(from_code, action_code, action_label, to_code, default_comment, sort_order)
JOIN "workflow_states" origin ON origin."code" = route.from_code
JOIN "workflow_states" target ON target."code" = route.to_code;

-- Preserve the currently configured field and attachment permissions of Riesgo.
INSERT INTO "solicitud_field_access_rules" (
  "id", "workflow_state_id", "default_mode", "editable_fields", "editable_groups",
  "can_manage_attachments", "readonly_reason", "background_color", "text_color",
  "active", "version", "created_at", "updated_at", "updated_by"
)
SELECT gen_random_uuid(), target."id", rule."default_mode", rule."editable_fields", rule."editable_groups",
  rule."can_manage_attachments", rule."readonly_reason", rule."background_color", rule."text_color",
  rule."active", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
FROM "solicitud_field_access_rules" rule
JOIN "workflow_states" source ON source."id" = rule."workflow_state_id" AND source."code" = 'RevisionRiesgo'
CROSS JOIN "workflow_states" target
WHERE target."code" = 'EvaluacionExterna';

COMMIT;
