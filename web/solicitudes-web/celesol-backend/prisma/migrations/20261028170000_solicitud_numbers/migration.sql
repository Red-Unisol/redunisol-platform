BEGIN;

-- Serialize the backfill with all writers, including older application instances.
LOCK TABLE solicitudes IN ACCESS EXCLUSIVE MODE;

CREATE SEQUENCE solicitudes_nro_solicitud_seq AS BIGINT
    MINVALUE 500001 START WITH 500001 NO CYCLE;
ALTER SEQUENCE solicitudes_nro_solicitud_seq OWNED BY solicitudes.nro_solicitud;

-- Preserve assigned references. Begin above any existing numeric reference.
SELECT setval('solicitudes_nro_solicitud_seq', GREATEST(
    500001,
    COALESCE(MAX(CASE WHEN nro_solicitud ~ '^[0-9]+$'
        THEN nro_solicitud::bigint END), 500000) + 1
), false) FROM solicitudes;

-- The reservation guard freezes this column too. Disable only that guard while
-- holding the exclusive lock, and restore it before any writer can resume.
ALTER TABLE solicitudes DISABLE TRIGGER freeze_reserved_solicitud;
WITH numbered AS MATERIALIZED (
    SELECT id, nextval('solicitudes_nro_solicitud_seq')::text AS numero
    FROM (
        SELECT id FROM solicitudes WHERE nro_solicitud IS NULL
        ORDER BY created_at, id
    ) AS pending
)
UPDATE solicitudes AS s SET nro_solicitud = n.numero
FROM numbered AS n WHERE s.id = n.id;
ALTER TABLE solicitudes ENABLE TRIGGER freeze_reserved_solicitud;

ALTER TABLE solicitudes ALTER COLUMN nro_solicitud
    SET DEFAULT nextval('solicitudes_nro_solicitud_seq')::text;

COMMIT;
