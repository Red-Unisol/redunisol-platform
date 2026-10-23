ALTER TABLE solicitudes ADD COLUMN monto_aprobado_riesgo DECIMAL(18, 2);

-- Las que ya estan en manos del vendedor toman como tope su monto actual.
UPDATE solicitudes s
SET monto_aprobado_riesgo = s.monto_a_financiar
FROM workflow_states ws
WHERE ws.id = s.estado_actual_id
  AND ws.code IN ('PreAprobada', 'Revisar');
