-- El comentario libre es opcional; se conserva el comentario automático.
UPDATE "workflow_transitions" AS transition
SET "requires_comment" = false, "updated_at" = CURRENT_TIMESTAMP
FROM "workflow_states" AS source, "workflow_states" AS destination
WHERE transition."from_state_id" = source."id"
  AND transition."to_state_id" = destination."id"
  AND source."code" = 'Liquidada'
  AND destination."code" = 'VerificarFirmaYDocumentacion'
  AND transition."action_code" = 'verificar_firma';
