ALTER TABLE transferencia_desembolsos ADD COLUMN bank_started_at TIMESTAMP(3);

CREATE TABLE solicitud_pagos_externos (
    id UUID PRIMARY KEY,
    solicitud_id UUID NOT NULL UNIQUE REFERENCES solicitudes(id) ON DELETE RESTRICT,
    desembolso_id UUID UNIQUE REFERENCES transferencia_desembolsos(id) ON DELETE RESTRICT,
    paid_on DATE NOT NULL,
    reference TEXT NOT NULL,
    comment TEXT,
    receipt_sha256 TEXT NOT NULL,
    adjunto_id UUID NOT NULL UNIQUE REFERENCES solicitud_adjuntos(id) ON DELETE RESTRICT,
    recorded_by UUID NOT NULL REFERENCES users(usr_id) ON DELETE RESTRICT,
    recorded_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION beex_preserve_external_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'BEEX_EXTERNAL_PAYMENT_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER preserve_external_payment BEFORE UPDATE OR DELETE ON solicitud_pagos_externos
FOR EACH ROW EXECUTE FUNCTION beex_preserve_external_payment();

CREATE OR REPLACE FUNCTION beex_protect_transfer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM transferencia_desembolsos WHERE receipt_adjunto_id = OLD.id)
     OR EXISTS (SELECT 1 FROM solicitud_pagos_externos WHERE adjunto_id = OLD.id) THEN
    RAISE EXCEPTION 'BEEX_TRANSFERENCIAS_LOCKED' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
