-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SolicitudParticipantRole" AS ENUM ('CREATOR', 'OPERATOR', 'ASSIGNED', 'WATCHER');

-- CreateEnum
CREATE TYPE "SolicitudParticipantSource" AS ENUM ('CREATE', 'STATE_CHANGE', 'MANUAL_ASSIGNMENT', 'ATTACHMENT_UPLOAD', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TipoPersona" AS ENUM ('FISICA', 'JURIDICA');

-- CreateTable
CREATE TABLE "users" (
    "usr_id" UUID NOT NULL,
    "usr_email" TEXT NOT NULL,
    "usr_legacy_user" TEXT NOT NULL,
    "usr_password_hash" TEXT NOT NULL,
    "usr_first_name" TEXT,
    "usr_last_name" TEXT,
    "usr_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "usr_is_system_admin" BOOLEAN NOT NULL DEFAULT false,
    "usr_state" INTEGER NOT NULL DEFAULT 1,
    "usr_created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usr_updated_at" TIMESTAMP(3) NOT NULL,
    "usr_deleted_at" TIMESTAMP(3),
    "workflow_owner_id" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("usr_id")
);

-- CreateTable
CREATE TABLE "workflow_owners" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "workflow_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_states" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_initial" BOOLEAN NOT NULL DEFAULT false,
    "is_terminal" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "socios" (
    "id" UUID NOT NULL,
    "tipo_persona" "TipoPersona" NOT NULL,
    "cuit" TEXT NOT NULL,
    "email" TEXT,
    "celular" TEXT,
    "nro_socio_legacy" TEXT,
    "apellido" TEXT,
    "nombre" TEXT,
    "nro_documento" TEXT,
    "tipo_documento" TEXT,
    "sexo" TEXT,
    "fecha_de_nacimiento" DATE,
    "razon_social" TEXT,
    "domicilio_calle" TEXT,
    "domicilio_nro_puerta" TEXT,
    "domicilio_localidad" TEXT,
    "domicilio_codigo_postal" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "socios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "socios_tipo_persona_check" CHECK (
        (
            "tipo_persona" = 'FISICA'
            AND "apellido" IS NOT NULL
            AND "nombre" IS NOT NULL
            AND "nro_documento" IS NOT NULL
            AND "tipo_documento" IS NOT NULL
            AND "sexo" IS NOT NULL
            AND "fecha_de_nacimiento" IS NOT NULL
        )
        OR
        (
            "tipo_persona" = 'JURIDICA'
            AND "apellido" IS NULL
            AND "nombre" IS NULL
            AND "nro_documento" IS NULL
            AND "tipo_documento" IS NULL
            AND "sexo" IS NULL
            AND "fecha_de_nacimiento" IS NULL
        )
    )
);

-- CreateTable
CREATE TABLE "solicitudes" (
    "id" UUID NOT NULL,
    "legacy_oid" TEXT,
    "nro_solicitud" TEXT,
    "fecha_primer_vencimiento" DATE,
    "estado_actual_id" UUID NOT NULL,
    "linea_prestamo_legacy_oid" TEXT NOT NULL,
    "linea_prestamo_descripcion" TEXT NOT NULL,
    "monto_a_financiar" DECIMAL(18,2),
    "cuota_resultante" TEXT,
    "cuotas" INTEGER,
    "motivo" TEXT,
    "nro_operacion" TEXT,
    "cupo_titular" DECIMAL(18,2),
    "firma_digitalmente" BOOLEAN NOT NULL DEFAULT false,
    "link_firma_digital" TEXT,
    "ejecutivo_solicitud" TEXT,
    "vendedor_solicitud" TEXT,
    "vendedor_id" UUID,
    "observaciones" TEXT,
    "created_by" UUID NOT NULL,
    "assigned_to_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "solicitudes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud_participants" (
    "id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "SolicitudParticipantRole" NOT NULL,
    "source" "SolicitudParticipantSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "solicitud_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transitions" (
    "id" UUID NOT NULL,
    "from_state_id" UUID NOT NULL,
    "to_state_id" UUID NOT NULL,
    "action_code" TEXT NOT NULL,
    "action_label" TEXT NOT NULL,
    "default_comment" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL,
    "save_and_exit" BOOLEAN NOT NULL DEFAULT false,
    "requires_comment" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud_estado_historial" (
    "id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "transition_id" UUID,
    "estado_anterior_id" UUID,
    "estado_nuevo_id" UUID NOT NULL,
    "from_state_code_snapshot" TEXT,
    "to_state_code_snapshot" TEXT NOT NULL,
    "from_state_name_snapshot" TEXT,
    "to_state_name_snapshot" TEXT NOT NULL,
    "from_owner_id_snapshot" UUID,
    "to_owner_id_snapshot" UUID,
    "from_owner_code_snapshot" TEXT,
    "to_owner_code_snapshot" TEXT,
    "from_owner_name_snapshot" TEXT,
    "to_owner_name_snapshot" TEXT,
    "action_code" TEXT,
    "action_label" TEXT,
    "save_and_exit" BOOLEAN,
    "requires_comment" BOOLEAN,
    "motivo" TEXT,
    "comentario" TEXT,
    "metadata" JSONB,
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitud_estado_historial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud_titulares" (
    "solicitud_id" UUID NOT NULL,
    "tipo_documento" TEXT,
    "nro_documento" TEXT,
    "cuit" TEXT,
    "nro_socio" TEXT,
    "apellido_denominacion" TEXT,
    "nombre" TEXT,
    "email" TEXT,
    "celular" TEXT,
    "telefono_fijo" TEXT,
    "domicilio_calle" TEXT,
    "nro_puerta" TEXT,
    "localidad" TEXT,
    "cbu" TEXT,
    "persona_expuesta_politicamente" BOOLEAN,
    "sexo" TEXT,
    "nacionalidad" TEXT,
    "estado_civil" TEXT,
    "fecha_nacimiento" DATE,

    CONSTRAINT "solicitud_titulares_pkey" PRIMARY KEY ("solicitud_id")
);

-- CreateTable
CREATE TABLE "solicitud_datos_laborales" (
    "solicitud_id" UUID NOT NULL,
    "empleador" TEXT,
    "actividad_laboral" TEXT,
    "relacion_laboral" TEXT,
    "antiguedad_laboral_meses" INTEGER,
    "fecha_ingreso_laboral" DATE,
    "domicilio_laboral_calle" TEXT,
    "domicilio_laboral_nro_puerta" TEXT,
    "domicilio_laboral_piso_depto" TEXT,
    "domicilio_laboral_localidad" TEXT,
    "monto_recibo" DECIMAL(18,2),
    "descuentos_sueldo" DECIMAL(18,2),
    "tarjetas" TEXT,
    "vehiculo" TEXT,
    "vivienda" TEXT,

    CONSTRAINT "solicitud_datos_laborales_pkey" PRIMARY KEY ("solicitud_id")
);

-- CreateTable
CREATE TABLE "solicitud_conyuges" (
    "solicitud_id" UUID NOT NULL,
    "apellido" TEXT,
    "nombre" TEXT,
    "tipo_documento" TEXT,
    "nro_documento" TEXT,
    "fecha_nacimiento" DATE,
    "sexo" TEXT,
    "actividad" TEXT,
    "ingresos_mensuales" DECIMAL(18,2),
    "nacionalidad" TEXT,

    CONSTRAINT "solicitud_conyuges_pkey" PRIMARY KEY ("solicitud_id")
);

-- CreateTable
CREATE TABLE "solicitud_garantias" (
    "id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "tipo_relacion" TEXT,
    "tipo_garantia" TEXT,
    "observaciones" TEXT,
    "tipo_documento" TEXT,
    "nro_documento" TEXT,
    "persona" TEXT,
    "cuit" TEXT,
    "nro_socio" TEXT,
    "denominacion" TEXT,
    "nombre" TEXT,
    "nombre_completo" TEXT,
    "sexo" TEXT,
    "fecha_nacimiento" DATE,
    "edad" INTEGER,
    "email" TEXT,
    "nacionalidad" TEXT,
    "estado_civil" TEXT,
    "telefono" TEXT,
    "celular" TEXT,
    "domicilio" TEXT,
    "ocupacion" TEXT,
    "ingreso_mensual" DECIMAL(18,2),
    "fecha_ingreso_laboral" DATE,
    "antiguedad_laboral_meses" INTEGER,
    "suma_ingresos" BOOLEAN NOT NULL DEFAULT false,
    "casado_con_titular" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitud_garantias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud_adjuntos" (
    "id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "legacy_oid" TEXT,
    "archivo_nombre" TEXT,
    "archivo_path" TEXT,
    "archivo_mime_type" TEXT,
    "archivo_size_bytes" BIGINT,
    "storage_bucket" TEXT,
    "nro_documento" TEXT,
    "descripcion" TEXT,
    "adicional" TEXT,
    "tipo_adjunto" TEXT,
    "estado_adjunto" TEXT,
    "restringido" BOOLEAN NOT NULL DEFAULT false,
    "comentario" TEXT,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,

    CONSTRAINT "solicitud_adjuntos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud_cancelaciones" (
    "id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "cuenta_a_debitar" TEXT NOT NULL,
    "cbu" TEXT NOT NULL,
    "cuenta_bancaria" TEXT NOT NULL,
    "socio" TEXT NOT NULL,
    "socio_legacy_id" TEXT,
    "monto" DECIMAL(18,2) NOT NULL,
    "notas" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,

    CONSTRAINT "solicitud_cancelaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud_field_access_rules" (
    "id" UUID NOT NULL,
    "workflow_state_id" UUID NOT NULL,
    "default_mode" TEXT NOT NULL DEFAULT 'readonly',
    "editable_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "editable_groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "can_manage_attachments" BOOLEAN NOT NULL DEFAULT false,
    "readonly_reason" TEXT,
    "background_color" TEXT,
    "text_color" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "solicitud_field_access_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud_field_access_rule_audit" (
    "id" UUID NOT NULL,
    "workflow_state_id" UUID NOT NULL,
    "state_code_snapshot" TEXT NOT NULL,
    "state_name_snapshot" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "previous_value" JSONB,
    "next_value" JSONB,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID,

    CONSTRAINT "solicitud_field_access_rule_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "rtk_id" UUID NOT NULL,
    "usr_id" UUID NOT NULL,
    "rtk_token_hash" TEXT NOT NULL,
    "rtk_expires_at" TIMESTAMP(3) NOT NULL,
    "rtk_revoked_at" TIMESTAMP(3),
    "rtk_replaced_by_token_hash" TEXT,
    "rtk_ip_address" TEXT,
    "rtk_user_agent" TEXT,
    "rtk_created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("rtk_id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "evt_id" UUID NOT NULL,
    "usr_id" UUID NOT NULL,
    "evt_token_hash" TEXT NOT NULL,
    "evt_expires_at" TIMESTAMP(3) NOT NULL,
    "evt_used_at" TIMESTAMP(3),
    "evt_created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("evt_id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "prt_id" UUID NOT NULL,
    "usr_id" UUID NOT NULL,
    "prt_token_hash" TEXT NOT NULL,
    "prt_expires_at" TIMESTAMP(3) NOT NULL,
    "prt_used_at" TIMESTAMP(3),
    "prt_created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("prt_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_usr_email_key" ON "users"("usr_email");

-- CreateIndex
CREATE UNIQUE INDEX "users_usr_legacy_user_key" ON "users"("usr_legacy_user");

-- CreateIndex
CREATE INDEX "users_workflow_owner_id_idx" ON "users"("workflow_owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_owners_code_key" ON "workflow_owners"("code");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_states_code_key" ON "workflow_states"("code");

-- CreateIndex
CREATE INDEX "workflow_states_owner_id_idx" ON "workflow_states"("owner_id");

-- CreateIndex
CREATE INDEX "workflow_states_is_initial_idx" ON "workflow_states"("is_initial");

-- CreateIndex
CREATE INDEX "workflow_states_is_active_idx" ON "workflow_states"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "socios_cuit_key" ON "socios"("cuit");

-- CreateIndex
CREATE UNIQUE INDEX "socios_nro_documento_key" ON "socios"("nro_documento");

-- CreateIndex
CREATE INDEX "socios_tipo_persona_idx" ON "socios"("tipo_persona");

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_legacy_oid_key" ON "solicitudes"("legacy_oid");

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_nro_solicitud_key" ON "solicitudes"("nro_solicitud");

-- CreateIndex
CREATE INDEX "solicitudes_estado_actual_id_idx" ON "solicitudes"("estado_actual_id");

-- CreateIndex
CREATE INDEX "solicitudes_created_by_idx" ON "solicitudes"("created_by");

-- CreateIndex
CREATE INDEX "solicitudes_assigned_to_user_id_idx" ON "solicitudes"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "solicitudes_vendedor_id_idx" ON "solicitudes"("vendedor_id");

-- CreateIndex
CREATE INDEX "solicitudes_created_at_idx" ON "solicitudes"("created_at");

-- CreateIndex
CREATE INDEX "solicitud_participants_solicitud_id_idx" ON "solicitud_participants"("solicitud_id");

-- CreateIndex
CREATE INDEX "solicitud_participants_user_id_idx" ON "solicitud_participants"("user_id");

-- CreateIndex
CREATE INDEX "solicitud_participants_created_by_idx" ON "solicitud_participants"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_participants_solicitud_id_user_id_key" ON "solicitud_participants"("solicitud_id", "user_id");

-- CreateIndex
CREATE INDEX "workflow_transitions_from_state_id_idx" ON "workflow_transitions"("from_state_id");

-- CreateIndex
CREATE INDEX "workflow_transitions_to_state_id_idx" ON "workflow_transitions"("to_state_id");

-- CreateIndex
CREATE INDEX "workflow_transitions_is_active_idx" ON "workflow_transitions"("is_active");

-- CreateIndex
CREATE INDEX "workflow_transitions_sort_order_idx" ON "workflow_transitions"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_transitions_from_state_id_action_code_key" ON "workflow_transitions"("from_state_id", "action_code");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_transitions_from_state_id_to_state_id_action_code_key" ON "workflow_transitions"("from_state_id", "to_state_id", "action_code");

-- CreateIndex
CREATE INDEX "solicitud_estado_historial_solicitud_id_idx" ON "solicitud_estado_historial"("solicitud_id");

-- CreateIndex
CREATE INDEX "solicitud_estado_historial_solicitud_id_changed_at_idx" ON "solicitud_estado_historial"("solicitud_id", "changed_at");

-- CreateIndex
CREATE INDEX "solicitud_estado_historial_transition_id_idx" ON "solicitud_estado_historial"("transition_id");

-- CreateIndex
CREATE INDEX "solicitud_estado_historial_estado_anterior_id_idx" ON "solicitud_estado_historial"("estado_anterior_id");

-- CreateIndex
CREATE INDEX "solicitud_estado_historial_estado_nuevo_id_idx" ON "solicitud_estado_historial"("estado_nuevo_id");

-- CreateIndex
CREATE INDEX "solicitud_estado_historial_changed_by_idx" ON "solicitud_estado_historial"("changed_by");

-- CreateIndex
CREATE INDEX "solicitud_titulares_nro_documento_idx" ON "solicitud_titulares"("nro_documento");

-- CreateIndex
CREATE INDEX "solicitud_conyuges_nro_documento_idx" ON "solicitud_conyuges"("nro_documento");

-- CreateIndex
CREATE INDEX "solicitud_garantias_solicitud_id_idx" ON "solicitud_garantias"("solicitud_id");

-- CreateIndex
CREATE INDEX "solicitud_garantias_nro_documento_idx" ON "solicitud_garantias"("nro_documento");

-- CreateIndex
CREATE INDEX "solicitud_garantias_cuit_idx" ON "solicitud_garantias"("cuit");

-- CreateIndex
CREATE INDEX "solicitud_garantias_nro_socio_idx" ON "solicitud_garantias"("nro_socio");

-- CreateIndex
CREATE INDEX "solicitud_adjuntos_solicitud_id_idx" ON "solicitud_adjuntos"("solicitud_id");

-- CreateIndex
CREATE INDEX "solicitud_adjuntos_legacy_oid_idx" ON "solicitud_adjuntos"("legacy_oid");

-- CreateIndex
CREATE INDEX "solicitud_adjuntos_tipo_adjunto_idx" ON "solicitud_adjuntos"("tipo_adjunto");

-- CreateIndex
CREATE INDEX "solicitud_adjuntos_estado_adjunto_idx" ON "solicitud_adjuntos"("estado_adjunto");

-- CreateIndex
CREATE INDEX "solicitud_adjuntos_uploaded_by_idx" ON "solicitud_adjuntos"("uploaded_by");

-- CreateIndex
CREATE INDEX "solicitud_adjuntos_uploaded_at_idx" ON "solicitud_adjuntos"("uploaded_at");

-- CreateIndex
CREATE INDEX "solicitud_cancelaciones_solicitud_id_idx" ON "solicitud_cancelaciones"("solicitud_id");

-- CreateIndex
CREATE INDEX "solicitud_cancelaciones_created_by_idx" ON "solicitud_cancelaciones"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_field_access_rules_workflow_state_id_key" ON "solicitud_field_access_rules"("workflow_state_id");

-- CreateIndex
CREATE INDEX "solicitud_field_access_rules_active_idx" ON "solicitud_field_access_rules"("active");

-- CreateIndex
CREATE INDEX "solicitud_field_access_rule_audit_workflow_state_id_idx" ON "solicitud_field_access_rule_audit"("workflow_state_id");

-- CreateIndex
CREATE INDEX "solicitud_field_access_rule_audit_workflow_state_id_changed_idx" ON "solicitud_field_access_rule_audit"("workflow_state_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_rtk_token_hash_key" ON "refresh_tokens"("rtk_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_evt_token_hash_key" ON "email_verification_tokens"("evt_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_prt_token_hash_key" ON "password_reset_tokens"("prt_token_hash");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_workflow_owner_id_fkey" FOREIGN KEY ("workflow_owner_id") REFERENCES "workflow_owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_states" ADD CONSTRAINT "workflow_states_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "workflow_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_estado_actual_id_fkey" FOREIGN KEY ("estado_actual_id") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("usr_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("usr_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "users"("usr_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_participants" ADD CONSTRAINT "solicitud_participants_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_participants" ADD CONSTRAINT "solicitud_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("usr_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_participants" ADD CONSTRAINT "solicitud_participants_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("usr_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_from_state_id_fkey" FOREIGN KEY ("from_state_id") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_to_state_id_fkey" FOREIGN KEY ("to_state_id") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_estado_historial" ADD CONSTRAINT "solicitud_estado_historial_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_estado_historial" ADD CONSTRAINT "solicitud_estado_historial_transition_id_fkey" FOREIGN KEY ("transition_id") REFERENCES "workflow_transitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_estado_historial" ADD CONSTRAINT "solicitud_estado_historial_estado_anterior_id_fkey" FOREIGN KEY ("estado_anterior_id") REFERENCES "workflow_states"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_estado_historial" ADD CONSTRAINT "solicitud_estado_historial_estado_nuevo_id_fkey" FOREIGN KEY ("estado_nuevo_id") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_estado_historial" ADD CONSTRAINT "solicitud_estado_historial_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("usr_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_titulares" ADD CONSTRAINT "solicitud_titulares_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_datos_laborales" ADD CONSTRAINT "solicitud_datos_laborales_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_conyuges" ADD CONSTRAINT "solicitud_conyuges_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_garantias" ADD CONSTRAINT "solicitud_garantias_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_adjuntos" ADD CONSTRAINT "solicitud_adjuntos_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_adjuntos" ADD CONSTRAINT "solicitud_adjuntos_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("usr_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_adjuntos" ADD CONSTRAINT "solicitud_adjuntos_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("usr_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_cancelaciones" ADD CONSTRAINT "solicitud_cancelaciones_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_cancelaciones" ADD CONSTRAINT "solicitud_cancelaciones_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("usr_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_cancelaciones" ADD CONSTRAINT "solicitud_cancelaciones_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("usr_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_field_access_rules" ADD CONSTRAINT "solicitud_field_access_rules_workflow_state_id_fkey" FOREIGN KEY ("workflow_state_id") REFERENCES "workflow_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_field_access_rule_audit" ADD CONSTRAINT "solicitud_field_access_rule_audit_workflow_state_id_fkey" FOREIGN KEY ("workflow_state_id") REFERENCES "workflow_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_usr_id_fkey" FOREIGN KEY ("usr_id") REFERENCES "users"("usr_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_usr_id_fkey" FOREIGN KEY ("usr_id") REFERENCES "users"("usr_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_usr_id_fkey" FOREIGN KEY ("usr_id") REFERENCES "users"("usr_id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Seed data: final state of the workflow/field-access catalog, reconstructed
-- by tracing every INSERT/UPDATE across the original migrations that built
-- it incrementally (renames, deprecations, and reconciliations against
-- legacy-imported data are collapsed into the end result — a fresh database
-- has no legacy rows to reconcile).

BEGIN;

-- 1) workflow_owners
INSERT INTO "workflow_owners" ("id", "code", "name", "sort_order", "is_active")
VALUES
  (gen_random_uuid(), 'VENDEDORES', 'Vendedores', 0, true),
  (gen_random_uuid(), 'SISTEMA', 'Sistema', 1, true),
  (gen_random_uuid(), 'RIESGO', 'Riesgo', 2, true),
  (gen_random_uuid(), 'TESORERIA', 'Tesoreria', 3, true),
  (gen_random_uuid(), 'HISTORIAL', 'Historial', 4, true);

-- 2) workflow_states
WITH required_states (code, name, owner_code, is_initial, is_terminal) AS (
  VALUES
    ('CargaVendedor', 'Carga Vendedor', 'VENDEDORES', true, false),
    ('Motor', 'Motor', 'SISTEMA', false, false),
    ('RevisionRiesgo', 'Revision Riesgo', 'RIESGO', false, false),
    ('Revisar', 'Revisar', 'VENDEDORES', false, false),
    ('PreAprobada', 'Pre Aprobada', 'VENDEDORES', false, false),
    ('Confirmada', 'Confirmada', 'RIESGO', false, false),
    ('Liquidada', 'Liquidada', 'VENDEDORES', false, false),
    ('VerificarFirmaYDocumentacion', 'Verificar Firma y Documentación', 'RIESGO', false, false),
    ('Transferir', 'Transferir', 'TESORERIA', false, false),
    ('Rechazada', 'Rechazada', 'HISTORIAL', false, true),
    ('Vencida', 'Vencida', 'HISTORIAL', false, true),
    ('Desestimada', 'Desestimada', 'HISTORIAL', false, true),
    ('Pagada', 'Pagada', 'HISTORIAL', false, true)
)
INSERT INTO "workflow_states" (
  "id", "owner_id", "code", "name", "description",
  "is_initial", "is_terminal", "is_active", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), wo."id", rs.code, rs.name, NULL,
  rs.is_initial, rs.is_terminal, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM required_states rs
JOIN "workflow_owners" wo ON wo."code" = rs.owner_code;

-- 3) workflow_transitions
WITH required_transitions (
  from_code, action_code, action_label, to_code,
  requires_comment, default_comment, sort_order
) AS (
  VALUES
    ('CargaVendedor', 'enviar', 'Enviar', 'Motor', false, 'Revisión de riesgo', 10),
    ('CargaVendedor', 'vencer', 'Vencida', 'Vencida', false, NULL, 20),
    ('CargaVendedor', 'desestimar', 'Desestimar', 'Desestimada', true, 'Desestimar', 30),
    ('Motor', 'motor', 'Motor', 'RevisionRiesgo', false, 'Revisión de riesgo', 10),
    ('Revisar', 'revisar_reenviar', 'Revisar/Reenviar', 'RevisionRiesgo', true, 'Devolver a Riesgo', 10),
    ('Revisar', 'desestimar', 'Desestimar', 'Desestimada', true, 'Desestimar', 20),
    ('PreAprobada', 'desestimar', 'Desestimar', 'Desestimada', true, 'Negativa del cliente', 10),
    ('PreAprobada', 'revisar_monto_cuota', 'Revisar si es posible brindar un monto o cuota distinta', 'RevisionRiesgo', true, 'Revisar si es posible brindar un monto o cuota distinta', 20),
    ('PreAprobada', 'confirmar', 'Confirmar', 'Confirmada', false, 'Confirmada', 30),
    ('RevisionRiesgo', 'rechazar', 'Rechazada', 'Rechazada', true, NULL, 10),
    ('RevisionRiesgo', 'revisar', 'Revisar', 'Revisar', true, 'Revisar documentación', 20),
    ('RevisionRiesgo', 'preaprobar', 'PreAprobada', 'PreAprobada', false, 'Preaprobada', 30),
    ('RevisionRiesgo', 'confirmar', 'Confirmar', 'Confirmada', false, 'Confirmación directa', 40),
    ('Confirmada', 'desestimar', 'Desestimar', 'Desestimada', true, 'Desestimar', 10),
    ('Confirmada', 'liquidar', 'Liquidada', 'Liquidada', false, 'Liquidada', 20),
    ('Liquidada', 'desestimar', 'Desestimar', 'Desestimada', true, 'Desestimar', 10),
    ('Liquidada', 'verificar_firma', 'Verificar Firma y Documentación', 'VerificarFirmaYDocumentacion', true, 'Verificar firma y documentación', 30),
    ('VerificarFirmaYDocumentacion', 'devolver_a_liquidada', 'Devolver a Liquidada', 'Liquidada', true, 'La documentación presenta errores', 10),
    ('VerificarFirmaYDocumentacion', 'transferir', 'Para Transferir', 'Transferir', false, NULL, 20),
    ('Transferir', 'pagar', 'Pagada', 'Pagada', false, NULL, 10)
)
INSERT INTO "workflow_transitions" (
  "id", "from_state_id", "to_state_id", "action_code", "action_label",
  "default_comment", "description", "sort_order", "save_and_exit",
  "requires_comment", "is_active", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), fs."id", ts."id", rt.action_code, rt.action_label,
  rt.default_comment, NULL, rt.sort_order, false,
  rt.requires_comment, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM required_transitions rt
JOIN "workflow_states" fs ON fs."code" = rt.from_code
JOIN "workflow_states" ts ON ts."code" = rt.to_code;

-- 4) solicitud_field_access_rules
WITH rules (
  state_code, editable_fields, editable_groups, readonly_reason,
  version, background_color, text_color
) AS (
  VALUES
    (
      'CargaVendedor',
      ARRAY[
        'solicitud.cupoTitular','solicitud.cuotaResultante','solicitud.cuotas',
        'solicitud.fechaPrimerVencimiento','solicitud.firmaDigitalmente','solicitud.linkFirmaDigital',
        'solicitud.montoAFinanciar','solicitud.motivo','solicitud.nroOperacion','solicitud.observaciones',
        'solicitud.vendedorSolicitud','titular.apellidoDenominacion','titular.cbu','titular.celular',
        'titular.cuit','titular.domicilioCalle','titular.email','titular.estadoCivil','titular.localidad',
        'titular.nacionalidad','titular.nombre','titular.nroDocumento','titular.nroPuerta','titular.nroSocio',
        'titular.personaExpuestaPoliticamente','titular.sexo','titular.telefonoFijo','titular.tipoDocumento',
        'conyuge.actividad','conyuge.apellido','conyuge.fechaNacimiento','conyuge.ingresosMensuales',
        'conyuge.nacionalidad','conyuge.nombre','conyuge.nroDocumento','conyuge.sexo','conyuge.tipoDocumento',
        'datosLaborales.actividadLaboral','datosLaborales.antiguedadLaboralMeses','datosLaborales.descuentosSueldo',
        'datosLaborales.domicilioLaboralCalle','datosLaborales.domicilioLaboralLocalidad',
        'datosLaborales.domicilioLaboralNroPuerta','datosLaborales.domicilioLaboralPisoDepto',
        'datosLaborales.empleador','datosLaborales.fechaIngresoLaboral','datosLaborales.montoRecibo',
        'datosLaborales.relacionLaboral','datosLaborales.tarjetas','datosLaborales.vehiculo','datosLaborales.vivienda',
        'garantias.antiguedadLaboralMeses','garantias.casadoConTitular','garantias.celular','garantias.cuit',
        'garantias.denominacion','garantias.domicilio','garantias.edad','garantias.email','garantias.estadoCivil',
        'garantias.fechaIngresoLaboral','garantias.fechaNacimiento','garantias.ingresoMensual','garantias.nacionalidad',
        'garantias.nombre','garantias.nombreCompleto','garantias.nroDocumento','garantias.nroSocio',
        'garantias.observaciones','garantias.ocupacion','garantias.persona','garantias.sexo','garantias.sumaIngresos',
        'garantias.telefono','garantias.tipoDocumento','garantias.tipoGarantia','garantias.tipoRelacion'
      ]::TEXT[],
      ARRAY[]::TEXT[], NULL::TEXT, 5, NULL::TEXT, NULL::TEXT
    ),
    (
      'Confirmada',
      ARRAY[
        'solicitud.cupoTitular','solicitud.cuotaResultante','solicitud.cuotas',
        'solicitud.fechaPrimerVencimiento','solicitud.firmaDigitalmente','solicitud.linkFirmaDigital',
        'solicitud.montoAFinanciar','solicitud.motivo','solicitud.nroOperacion','solicitud.observaciones',
        'solicitud.vendedorSolicitud','titular.apellidoDenominacion','titular.cbu','titular.celular',
        'titular.cuit','titular.domicilioCalle','titular.email','titular.estadoCivil','titular.localidad',
        'titular.nacionalidad','titular.nombre','titular.nroDocumento','titular.nroPuerta','titular.nroSocio',
        'titular.personaExpuestaPoliticamente','titular.sexo','titular.telefonoFijo','titular.tipoDocumento',
        'conyuge.actividad','conyuge.apellido','conyuge.fechaNacimiento','conyuge.ingresosMensuales',
        'conyuge.nacionalidad','conyuge.nombre','conyuge.nroDocumento','conyuge.sexo','conyuge.tipoDocumento',
        'datosLaborales.actividadLaboral','datosLaborales.antiguedadLaboralMeses','datosLaborales.descuentosSueldo',
        'datosLaborales.domicilioLaboralCalle','datosLaborales.domicilioLaboralLocalidad',
        'datosLaborales.domicilioLaboralNroPuerta','datosLaborales.domicilioLaboralPisoDepto',
        'datosLaborales.empleador','datosLaborales.fechaIngresoLaboral','datosLaborales.montoRecibo',
        'datosLaborales.relacionLaboral','datosLaborales.tarjetas','datosLaborales.vehiculo','datosLaborales.vivienda',
        'garantias.antiguedadLaboralMeses','garantias.casadoConTitular','garantias.celular','garantias.cuit',
        'garantias.denominacion','garantias.domicilio','garantias.edad','garantias.email','garantias.estadoCivil',
        'garantias.fechaIngresoLaboral','garantias.fechaNacimiento','garantias.ingresoMensual','garantias.nacionalidad',
        'garantias.nombre','garantias.nombreCompleto','garantias.nroDocumento','garantias.nroSocio',
        'garantias.observaciones','garantias.ocupacion','garantias.persona','garantias.sexo','garantias.sumaIngresos',
        'garantias.telefono','garantias.tipoDocumento','garantias.tipoGarantia','garantias.tipoRelacion'
      ]::TEXT[],
      ARRAY[]::TEXT[], NULL::TEXT, 5, NULL::TEXT, NULL::TEXT
    ),
    (
      'Desestimada', ARRAY['solicitud.observaciones']::TEXT[], ARRAY[]::TEXT[],
      'La solicitud no admite edicion de datos en su estado actual.'::TEXT, 2, '#FF7F7F'::TEXT, '#000000'::TEXT
    ),
    (
      'Liquidada', ARRAY['solicitud.firmaDigitalmente','solicitud.linkFirmaDigital']::TEXT[], ARRAY[]::TEXT[],
      'La solicitud no admite edicion de datos en su estado actual.'::TEXT, 2, NULL::TEXT, NULL::TEXT
    ),
    (
      'Motor', ARRAY[]::TEXT[], ARRAY[]::TEXT[],
      'La solicitud no admite edicion de datos en su estado actual.'::TEXT, 4, NULL::TEXT, NULL::TEXT
    ),
    (
      'PreAprobada', ARRAY['solicitud.observaciones']::TEXT[], ARRAY[]::TEXT[],
      'La solicitud no admite edicion de datos en su estado actual.'::TEXT, 3, '#C0FFFF'::TEXT, '#000000'::TEXT
    ),
    (
      'Rechazada', ARRAY[]::TEXT[], ARRAY[]::TEXT[],
      'La solicitud no admite edicion de datos en su estado actual.'::TEXT, 1, '#FF7F7F'::TEXT, '#000000'::TEXT
    ),
    (
      'Revisar',
      ARRAY[
        'solicitud.cupoTitular','solicitud.cuotaResultante','solicitud.cuotas','solicitud.fechaPrimerVencimiento',
        'solicitud.montoAFinanciar','solicitud.motivo','solicitud.nroOperacion','solicitud.observaciones',
        'solicitud.vendedorSolicitud','titular.apellidoDenominacion','titular.cbu','titular.celular','titular.cuit',
        'titular.domicilioCalle','titular.email','titular.estadoCivil','titular.localidad','titular.nacionalidad',
        'titular.nombre','titular.nroDocumento','titular.nroPuerta','titular.nroSocio',
        'titular.personaExpuestaPoliticamente','titular.sexo','titular.telefonoFijo','titular.tipoDocumento',
        'conyuge.actividad','conyuge.apellido','conyuge.fechaNacimiento','conyuge.ingresosMensuales',
        'conyuge.nacionalidad','conyuge.nombre','conyuge.nroDocumento','conyuge.sexo','conyuge.tipoDocumento',
        'datosLaborales.actividadLaboral','datosLaborales.antiguedadLaboralMeses','datosLaborales.descuentosSueldo',
        'datosLaborales.domicilioLaboralCalle','datosLaborales.domicilioLaboralLocalidad',
        'datosLaborales.domicilioLaboralNroPuerta','datosLaborales.domicilioLaboralPisoDepto',
        'datosLaborales.empleador','datosLaborales.fechaIngresoLaboral','datosLaborales.montoRecibo',
        'datosLaborales.relacionLaboral','datosLaborales.tarjetas','datosLaborales.vehiculo','datosLaborales.vivienda'
      ]::TEXT[],
      ARRAY['garantias']::TEXT[], NULL::TEXT, 1, NULL::TEXT, NULL::TEXT
    ),
    (
      'RevisionRiesgo',
      ARRAY[
        'solicitud.cupoTitular','solicitud.cuotaResultante','solicitud.cuotas',
        'solicitud.fechaPrimerVencimiento','solicitud.firmaDigitalmente','solicitud.linkFirmaDigital',
        'solicitud.montoAFinanciar','solicitud.motivo','solicitud.nroOperacion','solicitud.observaciones',
        'solicitud.vendedorSolicitud','titular.apellidoDenominacion','titular.cbu','titular.celular',
        'titular.cuit','titular.domicilioCalle','titular.email','titular.estadoCivil','titular.localidad',
        'titular.nacionalidad','titular.nombre','titular.nroDocumento','titular.nroPuerta','titular.nroSocio',
        'titular.personaExpuestaPoliticamente','titular.sexo','titular.telefonoFijo','titular.tipoDocumento',
        'conyuge.actividad','conyuge.apellido','conyuge.fechaNacimiento','conyuge.ingresosMensuales',
        'conyuge.nacionalidad','conyuge.nombre','conyuge.nroDocumento','conyuge.sexo','conyuge.tipoDocumento',
        'datosLaborales.actividadLaboral','datosLaborales.antiguedadLaboralMeses','datosLaborales.descuentosSueldo',
        'datosLaborales.domicilioLaboralCalle','datosLaborales.domicilioLaboralLocalidad',
        'datosLaborales.domicilioLaboralNroPuerta','datosLaborales.domicilioLaboralPisoDepto',
        'datosLaborales.empleador','datosLaborales.fechaIngresoLaboral','datosLaborales.montoRecibo',
        'datosLaborales.relacionLaboral','datosLaborales.tarjetas','datosLaborales.vehiculo','datosLaborales.vivienda',
        'garantias.antiguedadLaboralMeses','garantias.casadoConTitular','garantias.celular','garantias.cuit',
        'garantias.denominacion','garantias.domicilio','garantias.edad','garantias.email','garantias.estadoCivil',
        'garantias.fechaIngresoLaboral','garantias.fechaNacimiento','garantias.ingresoMensual','garantias.nacionalidad',
        'garantias.nombre','garantias.nombreCompleto','garantias.nroDocumento','garantias.nroSocio',
        'garantias.observaciones','garantias.ocupacion','garantias.persona','garantias.sexo','garantias.sumaIngresos',
        'garantias.telefono','garantias.tipoDocumento','garantias.tipoGarantia','garantias.tipoRelacion'
      ]::TEXT[],
      ARRAY[]::TEXT[], NULL::TEXT, 2, NULL::TEXT, NULL::TEXT
    ),
    (
      'Transferir', ARRAY[]::TEXT[], ARRAY[]::TEXT[],
      'La solicitud no admite edicion de datos en su estado actual.'::TEXT, 1, NULL::TEXT, NULL::TEXT
    ),
    (
      'Vencida', ARRAY[]::TEXT[], ARRAY[]::TEXT[],
      'La solicitud no admite edicion de datos en su estado actual.'::TEXT, 1, '#FF7F7F'::TEXT, '#000000'::TEXT
    ),
    (
      'VerificarFirmaYDocumentacion',
      ARRAY[
        'solicitud.cupoTitular','solicitud.cuotaResultante','solicitud.cuotas',
        'solicitud.fechaPrimerVencimiento','solicitud.firmaDigitalmente','solicitud.linkFirmaDigital',
        'solicitud.montoAFinanciar','solicitud.motivo','solicitud.nroOperacion','solicitud.observaciones',
        'solicitud.vendedorSolicitud','titular.apellidoDenominacion','titular.cbu','titular.celular',
        'titular.cuit','titular.domicilioCalle','titular.email','titular.estadoCivil','titular.localidad',
        'titular.nacionalidad','titular.nombre','titular.nroDocumento','titular.nroPuerta','titular.nroSocio',
        'titular.personaExpuestaPoliticamente','titular.sexo','titular.telefonoFijo','titular.tipoDocumento',
        'conyuge.actividad','conyuge.apellido','conyuge.fechaNacimiento','conyuge.ingresosMensuales',
        'conyuge.nacionalidad','conyuge.nombre','conyuge.nroDocumento','conyuge.sexo','conyuge.tipoDocumento',
        'datosLaborales.actividadLaboral','datosLaborales.antiguedadLaboralMeses','datosLaborales.descuentosSueldo',
        'datosLaborales.domicilioLaboralCalle','datosLaborales.domicilioLaboralLocalidad',
        'datosLaborales.domicilioLaboralNroPuerta','datosLaborales.domicilioLaboralPisoDepto',
        'datosLaborales.empleador','datosLaborales.fechaIngresoLaboral','datosLaborales.montoRecibo',
        'datosLaborales.relacionLaboral','datosLaborales.tarjetas','datosLaborales.vehiculo','datosLaborales.vivienda',
        'garantias.antiguedadLaboralMeses','garantias.casadoConTitular','garantias.celular','garantias.cuit',
        'garantias.denominacion','garantias.domicilio','garantias.edad','garantias.email','garantias.estadoCivil',
        'garantias.fechaIngresoLaboral','garantias.fechaNacimiento','garantias.ingresoMensual','garantias.nacionalidad',
        'garantias.nombre','garantias.nombreCompleto','garantias.nroDocumento','garantias.nroSocio',
        'garantias.observaciones','garantias.ocupacion','garantias.persona','garantias.sexo','garantias.sumaIngresos',
        'garantias.telefono','garantias.tipoDocumento','garantias.tipoGarantia','garantias.tipoRelacion'
      ]::TEXT[],
      ARRAY[]::TEXT[],
      NULL::TEXT, 2, '#FFC0FF'::TEXT, '#000000'::TEXT
    ),
    (
      'Pagada', ARRAY[]::TEXT[], ARRAY[]::TEXT[],
      'La solicitud no admite edicion de datos en su estado actual.'::TEXT, 1, '#C0FFC0'::TEXT, '#000000'::TEXT
    )
)
INSERT INTO "solicitud_field_access_rules" (
  "id", "workflow_state_id", "default_mode", "editable_fields", "editable_groups",
  "can_manage_attachments", "readonly_reason", "background_color", "text_color",
  "active", "version", "created_at", "updated_at", "updated_by"
)
SELECT
  gen_random_uuid(), ws."id", 'readonly', r.editable_fields, r.editable_groups,
  true, r.readonly_reason, r.background_color, r.text_color,
  true, r.version, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
FROM rules r
JOIN "workflow_states" ws ON ws."code" = r.state_code;

COMMIT;
