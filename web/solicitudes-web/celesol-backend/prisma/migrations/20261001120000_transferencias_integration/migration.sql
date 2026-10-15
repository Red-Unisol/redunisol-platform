-- CreateTable
CREATE TABLE "transferencia_desembolsos" (
    "id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "prestamo_legacy_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "reservation_hash" TEXT NOT NULL,
    "plan_version" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "client_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "verification_id" TEXT,
    "receipt_sha256" TEXT,
    "receipt_adjunto_id" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transferencia_desembolsos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transferencia_pagos" (
    "id" UUID NOT NULL,
    "desembolso_id" UUID NOT NULL,
    "payment_key" TEXT NOT NULL,
    "bank_transaction_id" TEXT NOT NULL,
    "bank_operation_id" TEXT,
    "confirmed_payload" JSONB,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "transferencia_pagos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transferencia_desembolsos_solicitud_id_key" ON "transferencia_desembolsos"("solicitud_id");

-- CreateIndex
CREATE UNIQUE INDEX "transferencia_desembolsos_prestamo_legacy_id_key" ON "transferencia_desembolsos"("prestamo_legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "transferencia_desembolsos_idempotency_key_key" ON "transferencia_desembolsos"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "transferencia_desembolsos_receipt_adjunto_id_key" ON "transferencia_desembolsos"("receipt_adjunto_id");

-- CreateIndex
CREATE UNIQUE INDEX "transferencia_pagos_bank_transaction_id_key" ON "transferencia_pagos"("bank_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transferencia_pagos_bank_operation_id_key" ON "transferencia_pagos"("bank_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "transferencia_pagos_desembolso_id_payment_key_key" ON "transferencia_pagos"("desembolso_id", "payment_key");

-- AddForeignKey
ALTER TABLE "transferencia_desembolsos" ADD CONSTRAINT "transferencia_desembolsos_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_pagos" ADD CONSTRAINT "transferencia_pagos_desembolso_id_fkey" FOREIGN KEY ("desembolso_id") REFERENCES "transferencia_desembolsos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Once reserved, financial inputs are immutable even through the ordinary UI.
-- Child edits lock the parent first, serializing them with reservation creation.
CREATE FUNCTION beex_freeze_reserved_solicitud() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reservation_id uuid;
BEGIN
  SELECT id INTO reservation_id FROM transferencia_desembolsos WHERE solicitud_id = OLD.id;
  IF reservation_id IS NOT NULL THEN
    IF ROW(NEW.legacy_oid, NEW.nro_solicitud, NEW.monto_a_financiar, NEW.linea_prestamo_legacy_oid, NEW.firma_digitalmente)
       IS DISTINCT FROM
       ROW(OLD.legacy_oid, OLD.nro_solicitud, OLD.monto_a_financiar, OLD.linea_prestamo_legacy_oid, OLD.firma_digitalmente)
       OR (NEW.estado_actual_id IS DISTINCT FROM OLD.estado_actual_id
           AND current_setting('beex.transferencias_desembolso', true) IS DISTINCT FROM reservation_id::text)
       OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'BEEX_TRANSFERENCIAS_LOCKED' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER freeze_reserved_solicitud BEFORE UPDATE ON solicitudes
FOR EACH ROW EXECUTE FUNCTION beex_freeze_reserved_solicitud();

CREATE FUNCTION beex_freeze_reserved_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_id uuid;
BEGIN
  request_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.solicitud_id ELSE NEW.solicitud_id END;
  PERFORM id FROM solicitudes WHERE id = request_id FOR UPDATE;
  -- Also forbid moving an existing child out of a reserved solicitud.
  IF EXISTS (SELECT 1 FROM transferencia_desembolsos WHERE solicitud_id = request_id)
     OR (TG_OP = 'UPDATE' AND EXISTS (
       SELECT 1 FROM transferencia_desembolsos WHERE solicitud_id = OLD.solicitud_id
     )) THEN
    RAISE EXCEPTION 'BEEX_TRANSFERENCIAS_LOCKED' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER freeze_reserved_titular BEFORE INSERT OR UPDATE OR DELETE ON solicitud_titulares
FOR EACH ROW EXECUTE FUNCTION beex_freeze_reserved_child();
CREATE TRIGGER freeze_reserved_cancelacion BEFORE INSERT OR UPDATE OR DELETE ON solicitud_cancelaciones
FOR EACH ROW EXECUTE FUNCTION beex_freeze_reserved_child();

-- Keep the receipt used to close the workflow available as audit evidence.
ALTER TABLE transferencia_desembolsos ADD CONSTRAINT transferencia_desembolsos_receipt_adjunto_id_fkey
FOREIGN KEY (receipt_adjunto_id) REFERENCES solicitud_adjuntos(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION beex_protect_transfer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM transferencia_desembolsos WHERE receipt_adjunto_id = OLD.id) THEN
    RAISE EXCEPTION 'BEEX_TRANSFERENCIAS_LOCKED' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER protect_transfer_receipt BEFORE UPDATE OR DELETE ON solicitud_adjuntos
FOR EACH ROW EXECUTE FUNCTION beex_protect_transfer_receipt();
