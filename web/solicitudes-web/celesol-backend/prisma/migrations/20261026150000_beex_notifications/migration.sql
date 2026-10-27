CREATE TABLE "beex_notifications" (
  "id" UUID NOT NULL,
  "recipient_id" UUID NOT NULL,
  "solicitud_id" UUID NOT NULL,
  "loan_id" TEXT NOT NULL,
  "event_key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "beex_notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "beex_notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("usr_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "beex_notifications_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "beex_notifications_recipient_id_event_key_key" ON "beex_notifications"("recipient_id", "event_key");
CREATE INDEX "beex_notifications_recipient_id_read_at_created_at_idx" ON "beex_notifications"("recipient_id", "read_at", "created_at");
CREATE INDEX "beex_notifications_solicitud_id_loan_id_idx" ON "beex_notifications"("solicitud_id", "loan_id");
