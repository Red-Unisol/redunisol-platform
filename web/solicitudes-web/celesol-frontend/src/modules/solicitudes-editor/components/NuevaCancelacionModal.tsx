import { Landmark, X } from "lucide-react";
import { useEffect, useState } from "react";

import { getSocioCancelacionDetalleById } from "@/modules/solicitudes/services/solicitudes-api";
import type { SocioMutualCancelacionListItem } from "@/modules/solicitudes/types/solicitudes";
import { StaticMoneyInput } from "@/shared/components/forms/money-input-field";
import { Button } from "@/shared/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";

import { ModalField, StyledSelect, legacyFieldClassName } from "./fields/base";

export type NuevaCancelacionValues = {
  cbu: string;
  cuentaADebitar: string;
  cuentaBancaria: string;
  monto: string;
  notas: string;
  socio: string;
  socioLegacyId: string;
};

function buildSocioLabel(socio: SocioMutualCancelacionListItem) {
  if (!socio.nombreCompleto) {
    return null;
  }

  const nombre = socio.nroSocio
    ? `${socio.nroSocio} - ${socio.nombreCompleto}`
    : socio.nombreCompleto;

  return socio.categoriaActualNombre
    ? `${nombre} (${socio.categoriaActualNombre})`
    : nombre;
}

type NuevaCancelacionModalProps = {
  defaultValues?: NuevaCancelacionValues;
  onOpenChange: (open: boolean) => void;
  onSave: (cancelacion: NuevaCancelacionValues) => void;
  open: boolean;
  saveLabel?: string;
  socios: SocioMutualCancelacionListItem[];
  title?: string;
};

export function NuevaCancelacionModal({
  defaultValues,
  onOpenChange,
  onSave,
  open,
  saveLabel = "Guardar",
  socios,
  title = "Nueva Cancelación",
}: NuevaCancelacionModalProps) {
  const [socioId, setSocioId] = useState("");
  const [cbu, setCbu] = useState("");
  const [cuentaBancaria, setCuentaBancaria] = useState("");
  const [socioMutual, setSocioMutual] = useState("");
  const [monto, setMonto] = useState("");
  const [notas, setNotas] = useState("");
  const [isLoadingDetalle, setIsLoadingDetalle] = useState(false);
  const [detalleError, setDetalleError] = useState<string | null>(null);

  const socioOptions = socios.flatMap((socio) => {
    if (socio.dadoDeBaja || !socio.id) {
      return [];
    }

    const label = buildSocioLabel(socio);

    return label ? [{ label, value: socio.id }] : [];
  });
  const selectedSocio = socios.find((socio) => socio.id === socioId);
  const canSave = Boolean(selectedSocio) && monto.trim().length > 0;

  function applyDraft(nextValues?: NuevaCancelacionValues) {
    setSocioId(nextValues?.socioLegacyId ?? "");
    setCbu(nextValues?.cbu ?? "");
    setCuentaBancaria(nextValues?.cuentaBancaria ?? "");
    setSocioMutual(nextValues?.socio ?? "");
    setMonto(nextValues?.monto ?? "");
    setNotas(nextValues?.notas ?? "");
    setIsLoadingDetalle(false);
    setDetalleError(null);
  }

  useEffect(() => {
    if (open) {
      applyDraft(defaultValues);
    }
  }, [defaultValues, open]);

  function resetDraft() {
    applyDraft();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetDraft();
    }

    onOpenChange(nextOpen);
  }

  async function handleSocioChange(nextSocioId: string) {
    setSocioId(nextSocioId);
    setCbu("");
    setCuentaBancaria("");
    setSocioMutual("");
    setDetalleError(null);

    if (!nextSocioId) {
      return;
    }

    setIsLoadingDetalle(true);

    try {
      const detalle = await getSocioCancelacionDetalleById(nextSocioId);
      setCbu(detalle.cuentaBancariaHabitual.cbu ?? "");
      setCuentaBancaria(
        [
          detalle.cuentaBancariaHabitual.nroCuenta,
          detalle.cuentaBancariaHabitual.nombre,
        ]
          .filter((value) => value && value.trim() !== "")
          .join(" - "),
      );
      setSocioMutual(detalle.nombreCompleto ?? "");
    } catch (error) {
      setDetalleError(
        error instanceof Error
          ? error.message
          : "No se pudieron obtener los datos del socio.",
      );
    } finally {
      setIsLoadingDetalle(false);
    }
  }

  function handleSave() {
    if (!selectedSocio) {
      return;
    }

    onSave({
      cbu,
      cuentaADebitar: buildSocioLabel(selectedSocio) ?? "",
      cuentaBancaria,
      monto,
      notas: notas.trim(),
      socio: socioMutual,
      socioLegacyId: socioId,
    });
    handleOpenChange(false);
  }

  return (
    <DialogRoot onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] max-w-[560px] flex-col overflow-hidden p-0">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-background text-foreground-secondary">
              <Landmark className="size-4" />
            </span>
            <DialogTitle className="text-2xl font-semibold leading-none text-foreground">
              {title}
            </DialogTitle>
          </div>
          <DialogClose asChild>
            <Button
              className="text-foreground-secondary"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <ModalField label="Cuenta a debitar*">
            <StyledSelect
              onChange={handleSocioChange}
              options={socioOptions}
              placeholder="Seleccione el socio"
              searchable
              value={socioId}
            />
            {isLoadingDetalle ? (
              <span className="text-xs text-foreground-muted">
                Cargando datos del socio...
              </span>
            ) : null}
            {detalleError ? (
              <span className="text-xs text-destructive">{detalleError}</span>
            ) : null}
          </ModalField>

          <div className="grid gap-4 md:grid-cols-2">
            <ModalField label="CBU">
              <Input
                onChange={(event) => setCbu(event.target.value)}
                value={cbu}
              />
            </ModalField>
            <ModalField label="Cuenta bancaria">
              <Input
                onChange={(event) => setCuentaBancaria(event.target.value)}
                value={cuentaBancaria}
              />
            </ModalField>
            <ModalField label="Socio Mutual">
              <Input
                onChange={(event) => setSocioMutual(event.target.value)}
                value={socioMutual}
              />
            </ModalField>
            <ModalField label="Monto*">
              <StaticMoneyInput onChange={setMonto} value={monto} />
            </ModalField>
          </div>

          <ModalField label="Notas">
            <textarea
              className={`${legacyFieldClassName} h-20 resize-none py-2`}
              onChange={(event) => setNotas(event.target.value)}
              value={notas}
            />
          </ModalField>
        </div>

        <footer className="shrink-0 border-t border-border bg-surface px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <Button disabled={!canSave} onClick={handleSave} type="button">
              {saveLabel}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
          </div>
        </footer>
      </DialogContent>
    </DialogRoot>
  );
}
