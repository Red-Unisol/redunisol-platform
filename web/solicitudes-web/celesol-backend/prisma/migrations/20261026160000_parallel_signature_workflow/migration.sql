-- A dedicated review area. Existing users are not silently reassigned.
INSERT INTO "workflow_owners" ("id", "code", "name", "sort_order", "is_active")
VALUES (gen_random_uuid(), 'LEGAJOS_DIGITALES', 'Legajos Digitales', 35, true)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "is_active" = true;
UPDATE "workflow_states" SET "owner_id" = (SELECT "id" FROM "workflow_owners" WHERE "code" = 'LEGAJOS_DIGITALES')
WHERE "code" = 'VerificarFirmaYDocumentacion';

-- Closing analysis never generates a loan. The locked executor chooses the
-- route with approval when an approval is already available.
UPDATE "workflow_transitions" SET
  "to_state_id" = (SELECT "id" FROM "workflow_states" WHERE "code" = 'VerificarFirmaYDocumentacion'),
  "action_label" = 'Mandar a revisar firma', "default_comment" = 'Análisis finalizado; firma pendiente de aprobación.',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "action_code" = 'liquidar' AND "from_state_id" = (SELECT "id" FROM "workflow_states" WHERE "code" = 'Confirmada');

INSERT INTO "workflow_transitions" ("id", "from_state_id", "to_state_id", "action_code", "action_label", "sort_order", "is_active", "save_and_exit", "requires_comment", "created_at", "updated_at")
SELECT gen_random_uuid(), origin."id", target."id", 'liquidar_con_firma', 'Mandar a transferir', 21, true, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "workflow_states" origin JOIN "workflow_states" target ON target."code" = 'Transferir'
WHERE origin."code" = 'Confirmada'
ON CONFLICT ("from_state_id", "action_code") DO UPDATE SET "to_state_id" = EXCLUDED."to_state_id", "is_active" = true, "action_label" = EXCLUDED."action_label";

-- Compatibility for loans already handed to sellers before this change.
INSERT INTO "workflow_transitions" ("id", "from_state_id", "to_state_id", "action_code", "action_label", "sort_order", "is_active", "save_and_exit", "requires_comment", "created_at", "updated_at")
SELECT gen_random_uuid(), origin."id", target."id", 'transferir', 'Firma aprobada; mandar a transferir', 22, true, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "workflow_states" origin JOIN "workflow_states" target ON target."code" = 'Transferir'
WHERE origin."code" = 'Liquidada'
ON CONFLICT ("from_state_id", "action_code") DO UPDATE SET "to_state_id" = EXCLUDED."to_state_id", "is_active" = true;

UPDATE "workflow_transitions" SET "is_active" = false, "updated_at" = CURRENT_TIMESTAMP
WHERE "action_code" = 'devolver_a_liquidada' AND "from_state_id" = (SELECT "id" FROM "workflow_states" WHERE "code" = 'VerificarFirmaYDocumentacion');
