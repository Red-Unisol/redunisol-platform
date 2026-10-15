-- 1) Flag de participacion en el reparto automatico.
--    Default false a proposito: nadie entra al round-robin por accidente.
ALTER TABLE "users" ADD COLUMN     "usr_recibe_asignacion_automatica" BOOLEAN NOT NULL DEFAULT false;

-- 2) Cursor del round-robin. La PK es el owner: garantiza a nivel de base
--    que no puedan existir dos cursores para el mismo owner.
CREATE TABLE "workflow_assignment_cursors" (
    "workflow_owner_id" UUID NOT NULL,
    "last_assigned_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_assignment_cursors_pkey" PRIMARY KEY ("workflow_owner_id")
);

-- AddForeignKey
ALTER TABLE "workflow_assignment_cursors" ADD CONSTRAINT "workflow_assignment_cursors_workflow_owner_id_fkey" FOREIGN KEY ("workflow_owner_id") REFERENCES "workflow_owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_assignment_cursors" ADD CONSTRAINT "workflow_assignment_cursors_last_assigned_user_id_fkey" FOREIGN KEY ("last_assigned_user_id") REFERENCES "users"("usr_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Seed: una fila de cursor por cada owner existente.
--    Es imprescindible: el SELECT ... FOR UPDATE necesita una fila que
--    bloquear. Si la fila no existe, no bloquea nada y dos envios
--    simultaneos podrian insertarla los dos.
INSERT INTO "workflow_assignment_cursors" (
  "workflow_owner_id", "last_assigned_user_id", "updated_at"
)
SELECT wo."id", NULL, CURRENT_TIMESTAMP
FROM "workflow_owners" wo
ON CONFLICT ("workflow_owner_id") DO NOTHING;

-- 4) Seed: habilitar el reparto automatico a los usuarios activos que hoy
--    pertenecen al owner RIESGO. Asi el sistema queda funcionando sin un
--    paso manual posterior al deploy.
UPDATE "users" u
SET "usr_recibe_asignacion_automatica" = true
FROM "workflow_owners" wo
WHERE u."workflow_owner_id" = wo."id"
  AND wo."code" = 'RIESGO'
  AND u."usr_state" = 1
  AND u."usr_deleted_at" IS NULL;
