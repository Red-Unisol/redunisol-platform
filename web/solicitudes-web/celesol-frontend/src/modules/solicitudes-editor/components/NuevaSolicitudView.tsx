import { Calculator, CircleAlert, Save } from "lucide-react";
import { Controller, useWatch } from "react-hook-form";

import type { CreateSolicitudCoreGarantiaRequest } from "@/modules/solicitudes/types/solicitudes-core";
import type {
  PendingSolicitudCoreAdjunto,
  SolicitudCoreAdjuntoResponse,
  UploadSolicitudCoreAdjuntoRequest,
} from "@/modules/solicitudes/types/solicitudes-core";
import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";
import {
  MoneyInputField,
  StaticMoneyInput,
} from "@/shared/components/forms/money-input-field";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils/cn";
import type {
  NuevaSolicitudFormValues,
  NuevaSolicitudTab,
  SolicitudFormControl,
  SolicitudFormRegister,
  StyledSelectOption,
} from "../types";
import {
  getCupoTitularPlaceholder,
  getCuotasPlaceholder,
  getMontoAFinanciarPlaceholder,
} from "../utils/linea-placeholders";
import type { AdjuntoLoteItem } from "./AdjuntosLoteModal";
import { AdjuntosNuevaSolicitud } from "./AdjuntosNuevaSolicitud";
import {
  DatosTitularFields,
  IdentificacionTitularFields,
} from "./NuevaSolicitudTitularSection";
import { StyledSelect, legacyFieldClassName } from "./fields/base";
import { mensajeDeError } from "../utils/mensaje-de-error";
import { StackedField } from "./fields/form-card";

const VALIDATION_FIELDS: Array<{
  key: keyof NuevaSolicitudFormValues;
  label: string;
}> = [
  { key: "linea", label: "Línea de préstamo" },
  { key: "montoAFinanciar", label: "Monto a financiar" },
  { key: "cuotas", label: "Cuotas" },
  { key: "documento", label: "Tipo de documento" },
  { key: "noDocumento", label: "Nro. de documento" },
  { key: "cuit", label: "CUIT" },
  { key: "apellidoDenominacion", label: "Apellido" },
  { key: "nombre", label: "Nombre" },
  { key: "fechaNacimiento", label: "Fecha de nacimiento" },
  { key: "cbu", label: "CBU" },
  { key: "cbuNoHabitual", label: "CBU Transferencias Cuenta No Habitual" },
];

// Resultado de buscar al socio por documento.
export type AvisoDocumento = { texto: string; tipo: "info" | "ok" };

type NuevaSolicitudViewProps = {
  avisoDocumento?: AvisoDocumento | null;
  cuotaCalculo: {
    mensaje: string | null;
    onCuotaChange: (value: string) => void;
    onDatosChange: () => void;
    onReintentar?: () => void;
    valor: string;
  };
  adjuntos: SolicitudCoreAdjuntoResponse[];
  control: SolicitudFormControl;
  garantias: CreateSolicitudCoreGarantiaRequest[];
  isLoadingLineas: boolean;
  isSaving: boolean;
  isUploadingAdjunto: boolean;
  lineas: LineaPrestamoPresolicitud[];
  onAddGarantia: (garantia: CreateSolicitudCoreGarantiaRequest) => void;
  errors?: Partial<
    Record<keyof NuevaSolicitudFormValues, { message?: string }>
  >;
  onAddAdjuntosLote: (items: AdjuntoLoteItem[]) => Promise<boolean>;
  onEditAdjunto?: (
    localId: string,
    payload: UploadSolicitudCoreAdjuntoRequest,
  ) => void;
  onDeleteAdjunto?: (localId: string) => void;
  onBack: () => void;
  onLookupTitularByDocumento: () => void;
  onOpenSimulador: () => void;
  pendingAdjuntos: PendingSolicitudCoreAdjunto[];
  onSave: () => void;
  // Ya no se usan aca: no hay pestañas (Garantias se quito) y el envio a
  // Riesgo se hace desde el detalle (al guardar se navega ahi).
  onTabChange: (tab: NuevaSolicitudTab) => void;
  register: SolicitudFormRegister;
  selectedLinea: LineaPrestamoPresolicitud | undefined;
  selectedWorkflowTransitionId: string;
  tab: NuevaSolicitudTab;
  workflowTransitionOptions: StyledSelectOption[];
  workflowTransitionPlaceholder: string;
  onWorkflowTransitionChange: (value: string) => void;
  isWorkflowTransitionDisabled: boolean;
};

const NUMERO = "font-semibold tabular-nums";

export function NuevaSolicitudView({
  avisoDocumento,
  cuotaCalculo,
  adjuntos,
  control,
  errors,
  isLoadingLineas,
  isSaving,
  isUploadingAdjunto,
  lineas,
  onAddAdjuntosLote,
  onEditAdjunto,
  onDeleteAdjunto,
  onLookupTitularByDocumento,
  onOpenSimulador,
  pendingAdjuntos,
  onSave,
  register,
  selectedLinea,
}: NuevaSolicitudViewProps) {
  const lineaOptions = lineas.flatMap((linea) => {
    const descripcion = linea.descripcion?.trim() ?? "";
    const oid = linea.oid?.trim() ?? "";

    if (!descripcion) {
      return [];
    }

    return [{ label: descripcion, value: oid || descripcion }];
  });
  const errorDe = mensajeDeError(errors);
  const errorItems = errors
    ? VALIDATION_FIELDS.filter(({ key }) => !!errors[key])
    : [];

  return (
    <div className="flex min-h-full flex-col">
      <form className="min-w-0 flex-1 space-y-3 p-2 md:p-4">
        {errorItems.length > 0 ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive"
            role="alert"
          >
            <CircleAlert className="size-4 shrink-0" />
            {/* El motivo de cada error esta debajo de su campo. */}
            <p className="font-medium">
              {errorItems.length === 1
                ? "Hay 1 dato para revisar. Está marcado en rojo."
                : `Hay ${errorItems.length} datos para revisar. Están marcados en rojo.`}
            </p>
          </div>
        ) : null}

        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          {/* Izquierda: quien pide. Arranca por el documento. */}
          <section className="rounded-lg border border-border bg-surface p-4">
            <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-border-soft pb-2">
              <h2 className="text-base font-semibold text-foreground">
                Titular
              </h2>
            </header>
            <IdentificacionTitularFields
              aviso={avisoDocumento}
              control={control}
              errors={errors}
              onLookupByDocumento={onLookupTitularByDocumento}
              register={register}
            />
            <div className="mt-3">
              <DatosTitularFields
                control={control}
                errors={errors}
                register={register}
              />
            </div>
          </section>

          {/* Derecha: el credito, siempre a la vista al bajar. */}
          <div className="space-y-3 lg:sticky lg:top-4">
            <section className="rounded-lg border border-border bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-soft pb-2">
                <h2 className="text-base font-semibold text-foreground">
                  Préstamo
                </h2>
                {selectedLinea ? (
                  <span className="flex flex-wrap gap-x-4 text-xs text-foreground-secondary">
                    <span>{getMontoAFinanciarPlaceholder(selectedLinea)}</span>
                    <span>{getCuotasPlaceholder(selectedLinea)}</span>
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                <StackedField
                  className="sm:col-span-2"
                  error={errorDe("linea")}
                  label="Línea"
                  required
                >
                  <Controller
                    control={control}
                    name="linea"
                    render={({ field }) => (
                      <StyledSelect
                        disabled={isLoadingLineas}
                        invalid={!!errors?.linea}
                        onChange={(value) => {
                          cuotaCalculo.onDatosChange();
                          field.onChange(value);
                        }}
                        options={lineaOptions}
                        placeholder={
                          isLoadingLineas
                            ? "Cargando líneas..."
                            : "Seleccione una línea"
                        }
                        searchable
                        value={field.value}
                      />
                    )}
                  />
                </StackedField>
                <StackedField
                  error={errorDe("montoAFinanciar")}
                  label="Monto a financiar"
                  required
                >
                  <MoneyInputField
                    className={NUMERO}
                    control={control}
                    invalid={!!errors?.montoAFinanciar}
                    name="montoAFinanciar"
                    transform={(value) => {
                      // Solo corre cuando escribe el usuario.
                      cuotaCalculo.onDatosChange();
                      return value;
                    }}
                  />
                </StackedField>
                <StackedField error={errorDe("cuotas")} label="Cuotas" required>
                  <input
                    aria-invalid={!!errors?.cuotas}
                    className={cn(legacyFieldClassName, NUMERO)}
                    inputMode="numeric"
                    {...register("cuotas", {
                      onChange: cuotaCalculo.onDatosChange,
                    })}
                  />
                </StackedField>
                {/* Editable: escribir una cuota calcula el monto, como en el
                    detalle y el simulador. */}
                <StackedField
                  hint={
                    cuotaCalculo.mensaje ? (
                      <span role="status">{cuotaCalculo.mensaje}</span>
                    ) : undefined
                  }
                  label="Cuota por mes"
                >
                  <StaticMoneyInput
                    aria-label="Cuota por mes"
                    className={NUMERO}
                    onChange={cuotaCalculo.onCuotaChange}
                    value={cuotaCalculo.valor}
                  />
                </StackedField>
                <StackedField label="Cupo del titular">
                  <MoneyInputField
                    control={control}
                    name="cupoTitular"
                    placeholder={
                      selectedLinea
                        ? getCupoTitularPlaceholder(selectedLinea)
                        : undefined
                    }
                  />
                </StackedField>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                {cuotaCalculo.onReintentar ? (
                  <Button
                    className="rounded-md"
                    onClick={cuotaCalculo.onReintentar}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Reintentar cuota
                  </Button>
                ) : null}
                <button
                  className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-verde hover:underline"
                  onClick={onOpenSimulador}
                  type="button"
                >
                  <Calculator className="size-4" />
                  Abrir simulador
                </button>
              </div>
            </section>
            <AdjuntosNuevaSolicitud
              adjuntos={adjuntos}
              isUploading={isUploadingAdjunto}
              onDeletePendingAdjunto={onDeleteAdjunto}
              onEditPendingAdjunto={onEditAdjunto}
              onNewAdjuntosLote={onAddAdjuntosLote}
              pendingAdjuntos={pendingAdjuntos}
            />
          </div>
        </div>
      </form>

      <BarraGuardar
        control={control}
        cuotaResultante={cuotaCalculo.valor}
        isSaving={isSaving}
        onSave={onSave}
      />
    </div>
  );
}

// Siempre a la vista: lo armado en una linea y el boton de guardar.
function BarraGuardar({
  control,
  cuotaResultante,
  isSaving,
  onSave,
}: {
  control: SolicitudFormControl;
  cuotaResultante: string;
  isSaving: boolean;
  onSave: () => void;
}) {
  const [monto, cuotas] = useWatch({
    control,
    name: ["montoAFinanciar", "cuotas"],
  });
  const montoTexto = monto?.trim();
  const cuotasTexto = cuotas?.trim();
  // Los montos ya vienen con "$" desde el campo de dinero.
  const conPesos = (texto?: string | null) =>
    texto ? (texto.startsWith("$") ? texto : `$ ${texto}`) : null;
  const datos = [
    { label: "Monto", value: conPesos(montoTexto) },
    { label: "Cuotas", value: cuotasTexto || null },
    {
      destacado: true,
      label: "Cuota por mes",
      value: conPesos(cuotaResultante),
    },
  ];

  return (
    <div className="sticky bottom-0 z-20 flex items-center gap-4 border-t border-verde/30 bg-[color-mix(in_oklab,var(--verde)_10%,white)] px-3 py-2.5 shadow-[0_-4px_12px_-6px_rgba(30,45,61,0.15)] md:px-4">
      {/* Lo que se va armando, siempre a la vista mientras se completa el formulario. */}
      <dl className="flex min-w-0 items-center gap-x-6 gap-y-1">
        {datos.map(({ destacado, label, value }) => (
          <div className="min-w-0" key={label}>
            <dt className="text-xs text-foreground-secondary">{label}</dt>
            <dd
              className={cn(
                "truncate text-base font-semibold tabular-nums",
                value
                  ? destacado
                    ? "text-verde"
                    : "text-foreground"
                  : "text-foreground-muted",
              )}
            >
              {value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
      <p className="ml-auto hidden max-w-56 text-right text-xs text-foreground-secondary lg:block">
        Una vez guardada, la solicitud se envía a Riesgo desde su detalle.
      </p>
      <Button
        className="ml-auto h-10 shrink-0 rounded-md bg-verde px-5 font-semibold text-white hover:bg-verde/90 lg:ml-0"
        disabled={isSaving}
        onClick={onSave}
        type="button"
      >
        <Save className="size-4" />
        {isSaving ? "Guardando…" : "Guardar solicitud"}
      </Button>
    </div>
  );
}
