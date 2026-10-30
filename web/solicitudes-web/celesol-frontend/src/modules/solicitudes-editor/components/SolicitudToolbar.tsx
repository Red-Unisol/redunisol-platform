import {
  CircleCheckBig,
  FileText,
  Landmark,
  Pencil,
  Paperclip,
  RefreshCw,
  Save,
  Send,
  UserPlus,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/shared/components/ui/button";

import { LegacyIconButton, LegacyToolbarButton } from "./fields/base";

export function NuevaSolicitudToolbar({
  isSaving = false,
  onOpenSimulador,
  onRefresh,
  onSave,
  transitionControl,
}: {
  isSaving?: boolean;
  onOpenSimulador: () => void;
  onRefresh?: () => void;
  onSave: () => void;
  transitionControl?: ReactNode;
}) {
  return (
    <div className="border-b border-border bg-linear-to-b from-white to-background/70 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <LegacyToolbarButton onClick={onOpenSimulador}>
          <FileText className="size-4 text-primary" />
          Simulador
        </LegacyToolbarButton>
        {transitionControl ? (
          <div className="min-w-[15rem] flex-1 sm:max-w-[24rem]">
            {transitionControl}
          </div>
        ) : null}
        <div className="ml-0 flex items-center gap-1 sm:ml-auto">
          <LegacyIconButton
            className="text-primary"
            disabled={!onRefresh}
            onClick={onRefresh}
          >
            <RefreshCw className="size-4" />
          </LegacyIconButton>
          <Button
            aria-label="Guardar"
            disabled={isSaving}
            onClick={onSave}
            size="icon-sm"
            type="button"
          >
            <Save className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SolicitudDetailToolbar({
  canEdit = false,
  embedded = false,
  isCreatePrestamoLegacyPending = false,
  isEditing = false,
  isSaving = false,
  onCancelEdit,
  isPrestamoLegacyGenerado = false,
  isSaveDisabled = false,
  onCreatePrestamoLegacy,
  onCreateSocio,
  onOpenSimulador,
  onPreloadSimulador,
  onRefresh,
  onSave,
  onStartEdit,
  transitionControl,
  submitAction,
  attachmentsAction,
  analysisAction,
  aviso,
}: {
  canEdit?: boolean;
  // Dentro de la ficha del detalle: sin franja propia.
  embedded?: boolean;
  isCreatePrestamoLegacyPending?: boolean;
  isEditing?: boolean;
  isSaving?: boolean;
  // Con esto, al editar se ven "Cancelar" y "Guardar cambios" con texto.
  onCancelEdit?: () => void;
  isPrestamoLegacyGenerado?: boolean;
  isSaveDisabled?: boolean;
  onCreatePrestamoLegacy?: () => void;
  onCreateSocio?: () => void;
  onOpenSimulador: () => void;
  onPreloadSimulador: () => void;
  onRefresh?: () => void;
  onSave?: () => void;
  onStartEdit?: () => void;
  transitionControl?: ReactNode;
  submitAction?: {
    onClick: () => void;
    disabled: boolean;
    disabledReason?: string;
  };
  attachmentsAction?: { onClick: () => void; count?: number };
  analysisAction?: {
    label: string;
    onClick: () => void;
    disabled: boolean;
    disabledReason?: string;
  };
  // Por que no se puede hacer la accion principal de la barra azul.
  aviso?: ReactNode;
}) {
  return (
    <div
      className={
        embedded
          ? "min-w-0 flex-1"
          : "shrink-0 border-b border-border bg-linear-to-b from-white to-background/70 px-3 py-2.5"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onFocus={onPreloadSimulador}
          onMouseEnter={onPreloadSimulador}
          onPointerDown={onPreloadSimulador}
          onClick={onOpenSimulador}
          size="sm"
          type="button"
          variant="outline"
        >
          <FileText className="size-4" />
          Simulador
        </Button>
        {submitAction ? (
          <Button
            disabled={submitAction.disabled}
            onClick={submitAction.onClick}
            title={submitAction.disabledReason}
            size="sm"
            type="button"
          >
            <Send className="size-4" aria-hidden="true" />
            Enviar a Riesgo
          </Button>
        ) : null}
        {analysisAction ? (
          <Button
            disabled={analysisAction.disabled}
            onClick={analysisAction.onClick}
            title={analysisAction.disabledReason}
            size="sm"
            type="button"
          >
            <Send className="size-4" />
            {analysisAction.label}
          </Button>
        ) : null}
        {attachmentsAction ? (
          <Button
            onClick={attachmentsAction.onClick}
            size="sm"
            type="button"
            variant="outline"
          >
            <Paperclip className="size-4" aria-hidden="true" />
            Adjuntos
            {attachmentsAction.count !== undefined
              ? ` (${attachmentsAction.count})`
              : ""}
          </Button>
        ) : null}
        {onCreateSocio ? (
          <Button
            onClick={onCreateSocio}
            size="sm"
            type="button"
            variant="outline"
          >
            <UserPlus className="size-4" />
            Crear socio
          </Button>
        ) : null}
        {onCreatePrestamoLegacy ? (
          isPrestamoLegacyGenerado ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/50 bg-success/20 px-3 py-1 text-xs font-medium text-success-foreground">
              <CircleCheckBig className="size-3.5" />
              Préstamo generado
            </span>
          ) : (
            <Button
              disabled={isCreatePrestamoLegacyPending}
              onClick={onCreatePrestamoLegacy}
              size="sm"
              type="button"
              variant="outline"
            >
              <Landmark className="size-4" />
              Generar Prestamo
            </Button>
          )
        ) : null}
        {transitionControl ? (
          <div
            className={
              embedded
                ? "w-44 shrink-0"
                : "min-w-[15rem] flex-1 sm:max-w-[24rem]"
            }
          >
            {transitionControl}
          </div>
        ) : null}
        <div className="ml-0 flex items-center gap-1 sm:ml-auto">
          {aviso ? <div className="mr-2">{aviso}</div> : null}
          {onRefresh ? (
            <Button
              aria-label="Actualizar"
              className="text-foreground-muted"
              onClick={onRefresh}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <RefreshCw className="size-4" />
            </Button>
          ) : null}
          {!isEditing && canEdit ? (
            <Button
              onClick={onStartEdit}
              size="sm"
              type="button"
              variant="outline"
            >
              <Pencil className="size-4" />
              Editar
            </Button>
          ) : null}
          {isEditing && onCancelEdit ? (
            // Siempre a la vista (la fila no scrollea): cancelar y guardar.
            <>
              <Button
                disabled={isSaving}
                onClick={onCancelEdit}
                size="sm"
                type="button"
                variant="outline"
              >
                Cancelar
              </Button>
              <Button
                disabled={isSaveDisabled}
                onClick={onSave}
                size="sm"
                type="button"
              >
                <Save className="size-4" />
                {isSaving ? "Guardando..." : "Guardar cambios"}
              </Button>
            </>
          ) : isEditing ? (
            <Button
              aria-label="Guardar"
              disabled={isSaveDisabled}
              onClick={onSave}
              size="icon-sm"
              type="button"
            >
              <Save className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
