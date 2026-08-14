import {
  CircleCheckBig,
  FileText,
  Landmark,
  Pencil,
  RefreshCw,
  Save,
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
  isCreatePrestamoLegacyPending = false,
  isEditing = false,
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
}: {
  canEdit?: boolean;
  isCreatePrestamoLegacyPending?: boolean;
  isEditing?: boolean;
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
}) {
  return (
    <div className="border-b border-border bg-linear-to-b from-white to-background/70 px-3 py-2.5">
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
          <div className="min-w-[15rem] flex-1 sm:max-w-[24rem]">
            {transitionControl}
          </div>
        ) : null}
        <div className="ml-0 flex items-center gap-1 sm:ml-auto">
          <Button
            aria-label="Actualizar"
            className="text-foreground-muted"
            disabled={!onRefresh}
            onClick={onRefresh}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
          </Button>
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
          {isEditing ? (
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
