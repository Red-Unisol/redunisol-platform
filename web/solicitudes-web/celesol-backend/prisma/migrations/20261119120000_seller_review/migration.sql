BEGIN;

ALTER TABLE "solicitudes" ADD COLUMN "seller_review_started_at" TIMESTAMP(3);

INSERT INTO "workflow_transitions" (
  "id", "from_state_id", "to_state_id", "action_code", "action_label",
  "default_comment", "sort_order", "save_and_exit", "requires_comment",
  "is_active", "created_at", "updated_at"
)
SELECT gen_random_uuid(), origin.id, target.id, route.action_code, route.label,
  route.comment, route.sort_order, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('Confirmada', 'enviar_a_liquidada', 'Enviar a liquidada', 'Liquidada', 'Pendiente de revisión de datos por Vendedores.', 15),
  ('Liquidada', 'finalizar_revision_datos', 'Finalizar revisión de datos', 'VerificarFirmaYDocumentacion', 'Datos confirmados sin cambios. Análisis finalizado.', 15),
  ('Liquidada', 'devolver_revision_datos', 'Devolución a Revisión de Riesgo', 'RevisionRiesgo', 'El vendedor corrigió datos de la solicitud.', 16)
) AS route(from_code, action_code, label, to_code, comment, sort_order)
JOIN workflow_states origin ON origin.code = route.from_code
JOIN workflow_states target ON target.code = route.to_code;

COMMIT;
