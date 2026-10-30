import { Calculator, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";
import type { SimulacionPrestamoResponse } from "@/modules/solicitudes/types/solicitudes-core";
import { useCuotaCalculada } from "@/modules/solicitudes-core/hooks/use-cuota-calculada";
import {
  ajustarMontoTexto,
  ajustarCuotasTexto,
} from "@/modules/solicitudes-shared/utils/maximos-linea";
import { StyledSelect } from "@/modules/solicitudes-editor/components/fields/base";
import {
  MoneyInputField,
  StaticMoneyInput,
} from "@/shared/components/forms/money-input-field";
import { Button } from "@/shared/components/ui/button";
import { DateInput } from "@/shared/components/ui/date-input";
import {
  DialogClose,
  DialogContent,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { TableLoader } from "@/shared/components/ui/table-loader";
import {
  formatDecimalMoneyValue,
  formatMoneyAmount,
  parseMoneyValue,
} from "@/shared/utils/money-format";
import { getCuotasFueraDeLineaError } from "@/modules/solicitudes-shared/utils/cuotas-linea";

type SimuladorPrestamoFormValues = {
  capitalFinanciado: string;
  condiciones: string;
  cuotaResultante: string;
  cuotas: string;
  fechaPrimerVencimiento: string;
  fechaUltimaCuota: string;
  gastosAdministrativos: string;
  lineaOid: string;
  montoAFinanciar: string;
  tasa: string;
  total: string;
};

export type SimulacionAplicada = {
  cuotaResultante: string;
  cuotas: string;
  fechaPrimerVencimiento: string;
  lineaOid: string;
  montoAFinanciar: string;
};

type SimuladorPrestamoModalProps = {
  lineas?: LineaPrestamoPresolicitud[];
  // Mientras se piden las lineas (simulador suelto de las listas).
  isLoadingLineas?: boolean;
  defaultLineaOid?: string;
  // Desde una solicitud: arranca con su monto y cuotas (si no, los maximos
  // de la linea).
  valoresIniciales?: { cuotas: number | null; montoAFinanciar: number | null };
  solicitudId?: string;
  onLimitsAdjusted?: () => void;
  onApply?: (valores: SimulacionAplicada) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const CAPITAL_PURO_DEFAULT = false;

const FIELD_CLASSNAME =
  "flex h-8 w-full min-w-0 rounded-sm border border-input-border bg-input-background px-2.5 py-1 text-xs text-foreground shadow-xs transition outline-none placeholder:text-foreground-muted focus-visible:border-input-focus focus-visible:ring-2 focus-visible:ring-input-focus/20 disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground";

function getLineaDefaults(linea?: LineaPrestamoPresolicitud | null) {
  return {
    cuotas:
      linea?.cantidadMaximaCuotas !== null &&
      linea?.cantidadMaximaCuotas !== undefined
        ? String(linea.cantidadMaximaCuotas)
        : "",
    montoAFinanciar:
      linea?.montoMaximo !== null && linea?.montoMaximo !== undefined
        ? formatMoneyAmount(linea.montoMaximo)
        : "",
    tasa:
      linea?.tasa !== null && linea?.tasa !== undefined
        ? String(linea.tasa)
        : "",
  };
}

export function SimuladorPrestamoModal({
  lineas = [],
  isLoadingLineas = false,
  defaultLineaOid,
  valoresIniciales,
  solicitudId,
  onLimitsAdjusted,
  onApply,
  onOpenChange,
  open,
}: SimuladorPrestamoModalProps) {
  const { control, register, reset, setValue } =
    useForm<SimuladorPrestamoFormValues>({
      defaultValues: {
        capitalFinanciado: "",
        condiciones: "",
        cuotaResultante: "",
        cuotas: "",
        fechaPrimerVencimiento: "",
        fechaUltimaCuota: "",
        gastosAdministrativos: "",
        lineaOid: "",
        montoAFinanciar: "",
        tasa: "",
        total: "",
      },
    });
  const [lineaOid, montoAFinanciar, cuotas, fechaPrimerVencimiento] = useWatch({
    control,
    name: ["lineaOid", "montoAFinanciar", "cuotas", "fechaPrimerVencimiento"],
  });
  const eligibleLineas = lineas.filter(
    (linea) => linea.vigente !== false && linea.oid,
  );
  const initialLinea =
    eligibleLineas.find((linea) => linea.oid === defaultLineaOid) ??
    eligibleLineas[0] ??
    null;
  const selectedLinea = eligibleLineas.find((linea) => linea.oid === lineaOid);
  const cuotasError = getCuotasFueraDeLineaError(cuotas, selectedLinea);
  // Cuota que escribio el usuario: con ella el legado calcula el monto (igual
  // que en el detalle). Vuelve a null si se toca monto, cuotas, linea o fecha.
  const [cuotaObjetivoTexto, setCuotaObjetivoTexto] = useState<string | null>(
    null,
  );
  // Al cerrar, la proxima apertura arranca calculando por monto.
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (!open) setCuotaObjetivoTexto(null);
  }
  const cuotaObjetivo =
    cuotaObjetivoTexto !== null ? parseMoneyValue(cuotaObjetivoTexto) : null;
  const simularPrestamoMutation = useCuotaCalculada(
    {
      ...(solicitudId ? { solicitudId } : {}),
      ...(cuotaObjetivo !== null && cuotaObjetivo > 0 ? { cuotaObjetivo } : {}),
      capitalPuro: CAPITAL_PURO_DEFAULT,
      lineaId: Number(selectedLinea?.oid),
      // Con cuota objetivo el monto lo busca el legado; la API igual pide uno
      // positivo, asi que sin monto cargado va el maximo de la linea.
      montoAFinanciar:
        cuotaObjetivo !== null
          ? parseMoneyValue(montoAFinanciar) ||
            (selectedLinea?.montoMaximo ?? 1)
          : parseMoneyValue(ajustarMontoTexto(montoAFinanciar, selectedLinea)),
      cuotas: Number(ajustarCuotasTexto(cuotas, selectedLinea)),
      ...(fechaPrimerVencimiento ? { fechaPrimerVencimiento } : {}),
    },
    Boolean(
      open &&
      selectedLinea?.oid &&
      !cuotasError &&
      Number(cuotas) > 0 &&
      (cuotaObjetivo !== null
        ? cuotaObjetivo > 0
        : parseMoneyValue(montoAFinanciar) > 0),
    ),
    (result) => {
      // Con cuota objetivo, que cambie el monto es el resultado, no un ajuste
      // por los maximos de la linea.
      if (
        (cuotaObjetivo === null &&
          parseMoneyValue(montoAFinanciar) !== result.montoAFinanciar) ||
        Number(cuotas) !== result.cuotas
      )
        onLimitsAdjusted?.();
      if (parseMoneyValue(montoAFinanciar) !== result.montoAFinanciar)
        setValue("montoAFinanciar", formatMoneyAmount(result.montoAFinanciar));
      if (Number(cuotas) !== result.cuotas)
        setValue("cuotas", String(result.cuotas));
    },
  );
  const simulacion: SimulacionPrestamoResponse | undefined =
    simularPrestamoMutation.data;

  const initialized = useRef(false);
  useEffect(() => {
    if (!open) {
      initialized.current = false;
      return;
    }
    if (!initialLinea || initialized.current) return;
    initialized.current = true;

    const lineaDefaults = getLineaDefaults(initialLinea);
    const desdeSolicitud =
      valoresIniciales && initialLinea.oid === defaultLineaOid
        ? valoresIniciales
        : null;

    reset({
      capitalFinanciado: "",
      condiciones: "",
      cuotaResultante: "",
      cuotas: desdeSolicitud?.cuotas
        ? String(desdeSolicitud.cuotas)
        : lineaDefaults.cuotas,
      fechaPrimerVencimiento: "",
      fechaUltimaCuota: "",
      gastosAdministrativos: "",
      lineaOid: initialLinea?.oid ?? "",
      montoAFinanciar: desdeSolicitud?.montoAFinanciar
        ? formatMoneyAmount(desdeSolicitud.montoAFinanciar)
        : lineaDefaults.montoAFinanciar,
      tasa: lineaDefaults.tasa,
      total: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, [open, initialLinea, reset]);

  useEffect(() => {
    if (!open || !selectedLinea) return;
    const montoAjustado = ajustarMontoTexto(montoAFinanciar, selectedLinea);
    const cuotasAjustadas = ajustarCuotasTexto(cuotas, selectedLinea);
    if (montoAjustado !== montoAFinanciar)
      setValue("montoAFinanciar", montoAjustado);
    if (cuotasAjustadas !== cuotas) setValue("cuotas", cuotasAjustadas);
  }, [open, selectedLinea, montoAFinanciar, cuotas, setValue]);

  function handleLineaChange(
    nextLineaOid: string,
    onFieldChange: (value: string) => void,
  ) {
    onFieldChange(nextLineaOid);
    setCuotaObjetivoTexto(null);

    const nextLinea = eligibleLineas.find(
      (linea) => linea.oid === nextLineaOid,
    );

    setValue("montoAFinanciar", ajustarMontoTexto(montoAFinanciar, nextLinea));
    setValue("cuotas", ajustarCuotasTexto(cuotas, nextLinea));
    setValue("tasa", "");
    setValue("fechaUltimaCuota", "");
    setValue("capitalFinanciado", "");
    setValue("cuotaResultante", "");
    setValue("gastosAdministrativos", "");
    setValue("total", "");
  }

  function handleRecalcular() {
    simularPrestamoMutation.recalculate();
  }

  useEffect(() => {
    setValue(
      "capitalFinanciado",
      simulacion ? formatMoneyAmount(simulacion.capital) : "",
    );
    setValue(
      "cuotaResultante",
      simulacion ? formatDecimalMoneyValue(simulacion.cuotaResultante) : "",
    );
    setValue(
      "gastosAdministrativos",
      simulacion ? formatMoneyAmount(simulacion.gastos) : "",
    );
    setValue("total", simulacion ? formatMoneyAmount(simulacion.total) : "");
    setValue("tasa", simulacion ? String(simulacion.tasa) : "");
    setValue(
      "fechaUltimaCuota",
      simulacion?.fechaUltimaCuota?.slice(0, 10) ?? "",
    );
  }, [simulacion, setValue]);

  function handleAplicar() {
    if (!simulacion || !selectedLinea?.oid || cuotasError) {
      return;
    }

    onApply?.({
      cuotaResultante: formatDecimalMoneyValue(simulacion.cuotaResultante),
      cuotas: String(simulacion.cuotas),
      fechaPrimerVencimiento:
        fechaPrimerVencimiento ||
        simulacion.fechaPrimerVencimiento?.slice(0, 10) ||
        "",
      lineaOid: selectedLinea.oid,
      montoAFinanciar: formatMoneyAmount(simulacion.montoAFinanciar),
    });
  }

  const cuotasDetalle = simulacion?.cuotasDetalle ?? null;
  const errorMessage =
    simularPrestamoMutation.error instanceof Error
      ? simularPrestamoMutation.error.message
      : null;

  return (
    <DialogRoot onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-[860px] overflow-hidden rounded-md p-0">
        <header className="flex items-center justify-between border-b border-border bg-background px-3 py-2">
          <div className="flex items-center gap-2">
            <Calculator className="size-4 text-primary" />
            <DialogTitle className="text-xs font-medium text-foreground">
              Simulador Préstamo
            </DialogTitle>
          </div>
          <DialogClose asChild>
            <Button
              aria-label="Cerrar simulador"
              className="text-foreground-muted"
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <X className="size-3.5" />
            </Button>
          </DialogClose>
        </header>

        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto p-3">
          <form className="space-y-3">
            {!isLoadingLineas && eligibleLineas.length === 0 ? (
              <p
                className="rounded-sm border border-border bg-surface px-2.5 py-2 text-[0.68rem] text-foreground-secondary"
                role="status"
              >
                No tenés líneas asignadas para simular. Las líneas salen del
                agente de tu usuario en Vimarx.
              </p>
            ) : null}
            {errorMessage ? (
              <p className="rounded-sm border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[0.68rem] text-destructive">
                {errorMessage}
              </p>
            ) : null}

            {/* Primero lo que se carga, despues lo que calcula el legado. */}
            <section aria-labelledby="simulador-datos" className="space-y-2">
              <h3
                className="text-[0.68rem] font-semibold uppercase tracking-wide text-foreground-muted"
                id="simulador-datos"
              >
                Datos del crédito
              </h3>
              <label className="grid gap-1">
                <span className="text-[0.68rem] font-medium text-foreground-secondary">
                  Línea<span className="text-destructive"> *</span>
                </span>
                <Controller
                  control={control}
                  name="lineaOid"
                  render={({ field }) => (
                    <StyledSelect
                      className="text-xs"
                      onChange={(value) =>
                        handleLineaChange(value, field.onChange)
                      }
                      options={eligibleLineas.map((linea) => ({
                        label: linea.descripcion ?? "",
                        value: linea.oid ?? "",
                      }))}
                      disabled={isLoadingLineas}
                      placeholder={
                        isLoadingLineas
                          ? "Cargando líneas..."
                          : "Seleccione una línea"
                      }
                      // Mismo buscador que al cargar la linea en la solicitud.
                      searchable
                      value={field.value}
                    />
                  )}
                />
              </label>
              <div className="grid gap-2 md:grid-cols-3">
                <label className="grid gap-1">
                  <span className="text-[0.68rem] font-medium text-foreground-secondary">
                    Monto a Financiar
                    <span className="text-destructive"> *</span>
                  </span>
                  <MoneyInputField
                    className="h-8 text-xs"
                    control={control}
                    name="montoAFinanciar"
                    transform={(value) => {
                      // Solo corre cuando escribe el usuario.
                      setCuotaObjetivoTexto(null);
                      return ajustarMontoTexto(value, selectedLinea);
                    }}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[0.68rem] font-medium text-foreground-secondary">
                    Cuotas<span className="text-destructive"> *</span>
                  </span>
                  <Input
                    aria-invalid={cuotasError ? true : undefined}
                    className="h-8 text-xs"
                    {...register("cuotas", {
                      onChange: (event) => {
                        setCuotaObjetivoTexto(null);
                        setValue(
                          "cuotas",
                          ajustarCuotasTexto(event.target.value, selectedLinea),
                        );
                      },
                    })}
                  />
                  {cuotasError ? (
                    <span className="text-[0.68rem] text-destructive">
                      {cuotasError}
                    </span>
                  ) : null}
                </label>
                <label className="grid gap-1">
                  <span className="text-[0.68rem] font-medium text-foreground-secondary">
                    Fecha Primer Vencimiento
                  </span>
                  <Controller
                    control={control}
                    name="fechaPrimerVencimiento"
                    render={({ field }) => (
                      <DateInput
                        className="h-8 text-xs"
                        name={field.name}
                        onBlur={field.onBlur}
                        onChange={(value) => {
                          setCuotaObjetivoTexto(null);
                          field.onChange(value);
                        }}
                        value={
                          field.value ||
                          simulacion?.fechaPrimerVencimiento?.slice(0, 10) ||
                          ""
                        }
                      />
                    )}
                  />
                </label>
              </div>
            </section>

            <section
              aria-labelledby="simulador-resultado"
              className="space-y-2 rounded-sm border border-border bg-surface p-2.5"
            >
              <h3
                className="text-[0.68rem] font-semibold uppercase tracking-wide text-foreground-muted"
                id="simulador-resultado"
              >
                Resultado
              </h3>
              <div className="grid gap-2 md:grid-cols-3">
                <label className="grid gap-1">
                  <span className="text-[0.68rem] font-medium text-foreground-secondary">
                    Cuota Resultante
                  </span>
                  {/* Editable: escribir una cuota calcula el monto. Muestra
                      el calculo si lo hay y, mientras, lo que se escribe. */}
                  <StaticMoneyInput
                    aria-label="Cuota Resultante"
                    className="h-9 text-sm font-semibold"
                    onChange={setCuotaObjetivoTexto}
                    value={
                      simulacion
                        ? formatDecimalMoneyValue(simulacion.cuotaResultante)
                        : (cuotaObjetivoTexto ?? "")
                    }
                  />
                  {cuotaObjetivo !== null ? (
                    <span
                      className="text-[0.68rem] text-foreground-secondary"
                      role="status"
                    >
                      {cuotaObjetivo <= 0
                        ? "Ingresá una cuota mayor a cero."
                        : simularPrestamoMutation.isPending
                          ? "Calculando el monto..."
                          : simulacion
                            ? "Monto calculado a partir de la cuota."
                            : null}
                    </span>
                  ) : null}
                </label>
                <label className="grid gap-1">
                  <span className="text-[0.68rem] font-medium text-foreground-secondary">
                    Capital Financiado
                  </span>
                  <Input
                    className="h-9 text-xs"
                    readOnly
                    {...register("capitalFinanciado")}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[0.68rem] font-medium text-foreground-secondary">
                    Total
                  </span>
                  <Input
                    className="h-9 text-xs"
                    readOnly
                    {...register("total")}
                  />
                </label>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <label className="grid gap-1">
                  <span className="text-[0.68rem] font-medium text-foreground-secondary">
                    Tasa
                  </span>
                  <Input
                    className="h-8 text-xs"
                    readOnly
                    {...register("tasa")}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[0.68rem] font-medium text-foreground-secondary">
                    Gastos Adm. (Liquidación)
                  </span>
                  <Input
                    className="h-8 text-xs"
                    readOnly
                    {...register("gastosAdministrativos")}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[0.68rem] font-medium text-foreground-secondary">
                    Fecha Última Cuota
                  </span>
                  <Input
                    className="h-8 text-xs"
                    readOnly
                    {...register("fechaUltimaCuota")}
                  />
                </label>
              </div>
            </section>

            <label className="grid gap-1">
              <span className="text-[0.68rem] font-medium text-foreground-secondary">
                Condiciones
              </span>
              <textarea
                className={`${FIELD_CLASSNAME} h-14 resize-none py-1.5`}
                {...register("condiciones")}
              />
            </label>

            <div className="h-[23rem] overflow-auto rounded-sm border border-border">
              {cuotasDetalle && cuotasDetalle.length > 0 ? (
                <table className="w-full min-w-[620px] border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-background text-foreground-secondary">
                    <tr>
                      <th className="px-2 py-2 text-left font-medium">
                        Nro Cuota
                      </th>
                      <th className="px-2 py-2 text-left font-medium">Fecha</th>
                      <th className="px-2 py-2 text-right font-medium">
                        Capital
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Interés
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Gastos
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Monto
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cuotasDetalle.map((cuota) => (
                      <tr
                        className="border-t border-border"
                        key={cuota.numeroCuota}
                      >
                        <td className="px-2 py-1.5">{cuota.numeroCuota}</td>
                        <td className="px-2 py-1.5">
                          {cuota.fechaVencimiento.slice(0, 10)}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {formatMoneyAmount(cuota.capital)}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {formatMoneyAmount(cuota.interes)}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {formatMoneyAmount(cuota.gastos)}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {formatMoneyAmount(cuota.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : simularPrestamoMutation.isPending ? (
                <TableLoader className="h-full" label="Calculando cuotas..." />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                  <Calculator
                    aria-hidden="true"
                    className="size-8 animate-pulse text-foreground-muted motion-reduce:animate-none"
                  />
                  <p className="text-[0.68rem] text-foreground-muted">
                    Seleccione línea, monto y cuotas para calcular.
                  </p>
                </div>
              )}
            </div>
          </form>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-3 py-2">
          <DialogClose asChild>
            <Button size="sm" type="button" variant="outline">
              Cancelar
            </Button>
          </DialogClose>
          <Button
            disabled={simularPrestamoMutation.isPending}
            onClick={() => void handleRecalcular()}
            size="sm"
            type="button"
            variant="outline"
          >
            {simularPrestamoMutation.isPending ? "Calculando..." : "Calcular"}
          </Button>
          {/* Sin onApply no hay a donde aplicar (por ejemplo, alguien que no
              puede editar la solicitud): mejor no mostrar un boton que no
              hace nada. */}
          {onApply ? (
            <Button
              disabled={!simulacion || cuotasError !== null}
              onClick={handleAplicar}
              size="sm"
              type="button"
            >
              Aplicar a Solicitud
            </Button>
          ) : null}
        </footer>
      </DialogContent>
    </DialogRoot>
  );
}
