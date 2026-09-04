import { Calculator, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";
import type {
  SimulacionPrestamoResponse,
  SimularPrestamoRequest,
} from "@/modules/solicitudes/types/solicitudes-core";
import { useSimularPrestamoMutation } from "@/modules/solicitudes-core/hooks/use-simular-prestamo-mutation";
import { MoneyInputField } from "@/shared/components/forms/money-input-field";
import { Button } from "@/shared/components/ui/button";
import { DateInput } from "@/shared/components/ui/date-input";
import {
  DialogClose,
  DialogContent,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { StyledSelect } from "@/shared/components/ui/styled-select";
import { TableLoader } from "@/shared/components/ui/table-loader";
import {
  formatDecimalMoneyValue,
  formatMoneyValue,
  parseMoneyValue,
} from "@/shared/utils/money-format";

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
  defaultLineaOid?: string;
  onApply?: (valores: SimulacionAplicada) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const CAPITAL_PURO_DEFAULT = false;
const AUTO_RECALCULAR_DEBOUNCE_MS = 400;

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
        ? formatMoneyValue(String(linea.montoMaximo))
        : "",
    tasa:
      linea?.tasa !== null && linea?.tasa !== undefined
        ? String(linea.tasa)
        : "",
  };
}

export function SimuladorPrestamoModal({
  lineas = [],
  defaultLineaOid,
  onApply,
  onOpenChange,
  open,
}: SimuladorPrestamoModalProps) {
  const { control, register, reset, setValue } =
    useForm<SimuladorPrestamoFormValues>({
      defaultValues: {
        capitalFinanciado: "0,00",
        condiciones: "",
        cuotaResultante: "0,00",
        cuotas: "",
        fechaPrimerVencimiento: "",
        fechaUltimaCuota: "",
        gastosAdministrativos: "0,00",
        lineaOid: "",
        montoAFinanciar: "",
        tasa: "",
        total: "0,00",
      },
    });
  const [lineaOid, montoAFinanciar, cuotas, fechaPrimerVencimiento, tasa] =
    useWatch({
      control,
      name: [
        "lineaOid",
        "montoAFinanciar",
        "cuotas",
        "fechaPrimerVencimiento",
        "tasa",
      ],
    });
  const eligibleLineas = lineas.filter(
    (linea) => linea.vigente !== false && linea.oid,
  );
  const initialLinea =
    eligibleLineas.find((linea) => linea.oid === defaultLineaOid) ??
    eligibleLineas[0] ??
    null;
  const selectedLinea = eligibleLineas.find((linea) => linea.oid === lineaOid);
  const simularPrestamoMutation = useSimularPrestamoMutation();
  const resetSimulacion = simularPrestamoMutation.reset;
  const simulacion: SimulacionPrestamoResponse | undefined =
    simularPrestamoMutation.data;
  const requestSeqRef = useRef(0);
  const skipNextAutoRecalcRef = useRef(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const lineaDefaults = getLineaDefaults(initialLinea);

    reset({
      capitalFinanciado: "0,00",
      condiciones: "",
      cuotaResultante: "0,00",
      cuotas: lineaDefaults.cuotas,
      fechaPrimerVencimiento: "",
      fechaUltimaCuota: "",
      gastosAdministrativos: "0,00",
      lineaOid: initialLinea?.oid ?? "",
      montoAFinanciar: lineaDefaults.montoAFinanciar,
      tasa: lineaDefaults.tasa,
      total: "0,00",
    });
    resetSimulacion();
  }, [open, initialLinea, reset, resetSimulacion]);

  function handleLineaChange(
    nextLineaOid: string,
    onFieldChange: (value: string) => void,
  ) {
    onFieldChange(nextLineaOid);

    const nextLinea = eligibleLineas.find(
      (linea) => linea.oid === nextLineaOid,
    );
    const lineaDefaults = getLineaDefaults(nextLinea);

    setValue("montoAFinanciar", lineaDefaults.montoAFinanciar);
    setValue("cuotas", lineaDefaults.cuotas);
    setValue("tasa", lineaDefaults.tasa);
    setValue("fechaUltimaCuota", "");
    setValue("capitalFinanciado", "0,00");
    setValue("cuotaResultante", "0,00");
    setValue("gastosAdministrativos", "0,00");
    setValue("total", "0,00");
  }

  async function handleRecalcular() {
    if (!selectedLinea?.oid) {
      return;
    }

    const parsedLineaId = Number(selectedLinea.oid);
    const parsedMontoAFinanciar = parseMoneyValue(montoAFinanciar);
    const parsedCuotas = Number(cuotas);
    const parsedTasa = tasa.trim() ? Number(tasa) : undefined;

    if (
      !Number.isFinite(parsedLineaId) ||
      !Number.isFinite(parsedMontoAFinanciar) ||
      !Number.isFinite(parsedCuotas)
    ) {
      return;
    }

    const payload: SimularPrestamoRequest = {
      capitalPuro: CAPITAL_PURO_DEFAULT,
      cuotas: parsedCuotas,
      lineaId: parsedLineaId,
      montoAFinanciar: parsedMontoAFinanciar,
      tasa: parsedTasa,
      ...(fechaPrimerVencimiento
        ? {
            fechaPrimerVencimiento: new Date(
              fechaPrimerVencimiento,
            ).toISOString(),
          }
        : {}),
    };

    const requestId = ++requestSeqRef.current;
    const result = await simularPrestamoMutation.mutateAsync(payload);

    if (requestId !== requestSeqRef.current) {
      // Una recalculación más nueva (disparada por un cambio posterior)
      // ya está en curso o ya resolvió; este resultado quedó viejo.
      return;
    }

    setValue("capitalFinanciado", formatMoneyValue(String(result.capital)));
    setValue(
      "cuotaResultante",
      formatDecimalMoneyValue(result.cuotaResultante),
    );
    setValue("gastosAdministrativos", formatMoneyValue(String(result.gastos)));
    setValue("tasa", String(result.tasa));
    setValue("total", formatMoneyValue(String(result.total)));

    const nextFechaPrimerVencimiento = result.fechaPrimerVencimiento
      ? result.fechaPrimerVencimiento.slice(0, 10)
      : "";

    if (nextFechaPrimerVencimiento !== fechaPrimerVencimiento) {
      // El legacy puede devolver una fecha (auto-calculada) distinta a la
      // que había en el campo (p.ej. estaba vacío). Ese setValue cambia el
      // valor observado por el efecto de auto-recálculo de abajo — sin este
      // flag, dispararía una segunda simulación automática apenas se llena
      // el campo, duplicando el cálculo.
      skipNextAutoRecalcRef.current = true;
    }

    setValue("fechaPrimerVencimiento", nextFechaPrimerVencimiento);
    setValue(
      "fechaUltimaCuota",
      result.fechaUltimaCuota ? result.fechaUltimaCuota.slice(0, 10) : "",
    );
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    if (skipNextAutoRecalcRef.current) {
      // Este cambio de fechaPrimerVencimiento vino del propio resultado
      // (ver handleRecalcular), no de una edición del usuario: se ignora
      // para no disparar una segunda simulación automática.
      skipNextAutoRecalcRef.current = false;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void handleRecalcular();
    }, AUTO_RECALCULAR_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
    // Se dispara solo, sin necesidad de apretar "Calcular", cuando el
    // usuario deja de tocar línea/monto/cuotas/fecha por un instante.
    // "tasa" queda afuera a propósito: es de solo lectura acá (se
    // autocompleta desde la línea o desde el propio resultado), incluirla
    // generaría un loop con el setValue("tasa", ...) de handleRecalcular.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lineaOid, montoAFinanciar, cuotas, fechaPrimerVencimiento]);

  function handleAplicar() {
    if (!simulacion || !selectedLinea?.oid) {
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
      montoAFinanciar: formatMoneyValue(String(simulacion.montoAFinanciar)),
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
            {errorMessage ? (
              <p className="rounded-sm border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[0.68rem] text-destructive">
                {errorMessage}
              </p>
            ) : null}

            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-2">
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
                        placeholder="Seleccione una línea"
                        value={field.value}
                      />
                    )}
                  />
                </label>
              </div>
              <div className="space-y-2">
                <label className="grid gap-1">
                  <span className="text-[0.68rem] font-medium text-foreground-secondary">
                    Cuota Resultante
                  </span>
                  <Input
                    className="h-8 text-xs"
                    readOnly
                    {...register("cuotaResultante")}
                  />
                </label>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              <label className="grid gap-1 md:col-span-1">
                <span className="text-[0.68rem] font-medium text-foreground-secondary">
                  Monto a Financiar<span className="text-destructive"> *</span>
                </span>
                <MoneyInputField
                  className="h-8 text-xs"
                  control={control}
                  name="montoAFinanciar"
                />
              </label>
              <label className="grid gap-1 md:col-span-1">
                <span className="text-[0.68rem] font-medium text-foreground-secondary">
                  Tasa
                </span>
                <Input className="h-8 text-xs" readOnly {...register("tasa")} />
              </label>
              <label className="grid gap-1 md:col-span-1">
                <span className="text-[0.68rem] font-medium text-foreground-secondary">
                  Gastos Adm. (Liquidación)
                </span>
                <Input
                  className="h-8 text-xs"
                  readOnly
                  {...register("gastosAdministrativos")}
                />
              </label>
              <label className="grid gap-1 md:col-span-1">
                <span className="text-[0.68rem] font-medium text-foreground-secondary">
                  Capital Financiado
                </span>
                <Input
                  className="h-8 text-xs"
                  readOnly
                  {...register("capitalFinanciado")}
                />
              </label>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-[0.68rem] font-medium text-foreground-secondary">
                  Cuotas<span className="text-destructive"> *</span>
                </span>
                <Input className="h-8 text-xs" {...register("cuotas")} />
              </label>
              <label className="grid gap-1">
                <span className="text-[0.68rem] font-medium text-foreground-secondary">
                  Total
                </span>
                <Input
                  className="h-8 text-xs"
                  readOnly
                  {...register("total")}
                />
              </label>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-[0.68rem] font-medium text-foreground-secondary">
                  Condiciones
                </span>
                <textarea
                  className={`${FIELD_CLASSNAME} h-[4.6rem] resize-none py-1.5`}
                  {...register("condiciones")}
                />
              </label>
              <div className="space-y-2">
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
                        onChange={field.onChange}
                        value={field.value}
                      />
                    )}
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
            </div>

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
                          {formatMoneyValue(String(cuota.capital))}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {formatMoneyValue(String(cuota.interes))}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {formatMoneyValue(String(cuota.gastos))}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {formatMoneyValue(String(cuota.total))}
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
          <Button
            disabled={!simulacion}
            onClick={handleAplicar}
            size="sm"
            type="button"
          >
            Aplicar a Solicitud
          </Button>
        </footer>
      </DialogContent>
    </DialogRoot>
  );
}
