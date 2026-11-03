-- "Pasó por Vimarx": cierra como Desestimada una solicitud que se siguió en
-- Vimarx. Se ofrece en las etapas que no son de vendedores. El historial guarda
-- la transición, así que estas desestimadas se distinguen de las demás por su
-- action_code sin agregar columnas.
INSERT INTO "workflow_transitions" (
  "id", "from_state_id", "to_state_id", "action_code", "action_label",
  "default_comment", "description", "sort_order", "save_and_exit",
  "requires_comment", "is_active", "created_at", "updated_at"
)
SELECT gen_random_uuid(), origin."id", target."id", 'paso_por_vimarx', 'Pasó por Vimarx',
  'Se siguió en Vimarx', 'Cierra la solicitud como Desestimada porque se siguió en Vimarx.',
  90, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "workflow_states" origin
JOIN "workflow_states" target ON target."code" = 'Desestimada'
WHERE origin."code" IN ('RevisionRiesgo', 'Confirmada', 'VerificarFirmaYDocumentacion', 'Transferir')
ON CONFLICT ("from_state_id", "action_code") DO UPDATE SET
  "to_state_id" = EXCLUDED."to_state_id", "action_label" = EXCLUDED."action_label",
  "default_comment" = EXCLUDED."default_comment", "description" = EXCLUDED."description",
  "sort_order" = EXCLUDED."sort_order", "save_and_exit" = false,
  "requires_comment" = true, "is_active" = true, "updated_at" = CURRENT_TIMESTAMP;
