-- Add the regular return path without changing existing state IDs or history.
INSERT INTO "workflow_transitions" (
  "id", "from_state_id", "to_state_id", "action_code", "action_label",
  "default_comment", "description", "sort_order", "save_and_exit",
  "requires_comment", "is_active", "created_at", "updated_at"
)
SELECT gen_random_uuid(), origin."id", target."id", 'revisar', 'Devolver a Revisar',
  'Devolver a Revisar', 'Devolución habitual de Confirmada a Vendedores para corregir la solicitud.',
  30, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "workflow_states" origin
JOIN "workflow_states" target ON target."code" = 'Revisar'
WHERE origin."code" = 'Confirmada'
ON CONFLICT ("from_state_id", "action_code") DO UPDATE SET
  "to_state_id" = EXCLUDED."to_state_id", "action_label" = EXCLUDED."action_label",
  "default_comment" = EXCLUDED."default_comment", "description" = EXCLUDED."description",
  "sort_order" = EXCLUDED."sort_order", "save_and_exit" = false,
  "requires_comment" = true, "is_active" = true, "updated_at" = CURRENT_TIMESTAMP;
