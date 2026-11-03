-- El cierre del analisis (Confirmada -> Verificar firma) se llama "Enviar a firmar".
UPDATE "workflow_transitions" SET "action_label" = 'Enviar a firmar', "updated_at" = CURRENT_TIMESTAMP
WHERE "action_code" = 'liquidar'
  AND "from_state_id" = (SELECT "id" FROM "workflow_states" WHERE "code" = 'Confirmada');
