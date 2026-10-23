import {
  ajustarMontoTexto,
  ajustarCuotasTexto,
} from "@/modules/solicitudes-shared/utils/maximos-linea";
import { useCuotaCalculada } from "@/modules/solicitudes-core/hooks/use-cuota-calculada";
import {
  parseMoneyValue,
  formatDecimalMoneyValue,
} from "@/shared/utils/money-format";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";

import { formatMoneyAmount } from "@/shared/utils/money-format";

import {
  ESTADO_CIVIL_OPTIONS,
  SEXO_OPTIONS,
} from "../constants/legacy-options";
import { NUEVA_SOLICITUD_DEFAULT_VALUES } from "../constants/solicitud-default-values";
import type { NuevaSolicitudFormValues } from "../types";

export function useSolicitudEditorForm(
  lineas: LineaPrestamoPresolicitud[],
  onLimitsAdjusted?: () => void,
) {
  const form = useForm<NuevaSolicitudFormValues>({
    defaultValues: NUEVA_SOLICITUD_DEFAULT_VALUES,
  });
  const [
    currentEstadoValue,
    selectedLineaValue,
    selectedLineaPrestamoLegacyOid,
  ] = useWatch({
    control: form.control,
    name: ["estado", "linea", "lineaPrestamoLegacyOid"],
  });
  const selectedLinea = useMemo(() => {
    const normalizedSelectedOid =
      selectedLineaValue?.trim() ||
      selectedLineaPrestamoLegacyOid?.trim() ||
      "";

    if (normalizedSelectedOid) {
      const matchedByOid = lineas.find(
        (linea) => (linea.oid ?? "").trim() === normalizedSelectedOid,
      );

      if (matchedByOid) {
        return matchedByOid;
      }
    }

    const normalizedSelectedDescription = selectedLineaValue?.trim() || "";

    if (!normalizedSelectedDescription) {
      return undefined;
    }

    return lineas.find(
      (linea) =>
        (linea.descripcion ?? "").trim() === normalizedSelectedDescription,
    );
  }, [lineas, selectedLineaPrestamoLegacyOid, selectedLineaValue]);

  useEffect(() => {
    const nextLineaPrestamoLegacyOid = selectedLinea?.oid ?? "";
    const currentLineaValue = form.getValues("linea");
    const currentLineaPrestamoLegacyOid = form.getValues(
      "lineaPrestamoLegacyOid",
    );

    if (
      currentLineaPrestamoLegacyOid === nextLineaPrestamoLegacyOid &&
      currentLineaValue === nextLineaPrestamoLegacyOid
    ) {
      return;
    }

    form.setValue("linea", nextLineaPrestamoLegacyOid, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });
    form.setValue("lineaPrestamoLegacyOid", nextLineaPrestamoLegacyOid, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });
  }, [form, selectedLinea]);

  useEffect(() => {
    if (!selectedLinea) {
      return;
    }

    const monto = form.getValues("montoAFinanciar");
    const cuotas = form.getValues("cuotas");
    const montoAjustado =
      monto || form.formState.dirtyFields.montoAFinanciar
        ? ajustarMontoTexto(monto, selectedLinea)
        : formatMoneyAmount(selectedLinea.montoMaximo);
    const cuotasAjustadas =
      cuotas || form.formState.dirtyFields.cuotas
        ? ajustarCuotasTexto(cuotas, selectedLinea)
        : String(selectedLinea.cantidadMaximaCuotas ?? "");
    if (monto !== montoAjustado)
      form.setValue("montoAFinanciar", montoAjustado);
    if (cuotas !== cuotasAjustadas) form.setValue("cuotas", cuotasAjustadas);
  }, [form, selectedLinea]);

  const [monto, cuotas, fecha] = useWatch({
    control: form.control,
    name: ["montoAFinanciar", "cuotas", "fechaPrimerVencimiento"],
  });
  // Cuota que escribio el usuario: con ella el legado calcula el monto (igual
  // que en el detalle). La vista la vuelve a null si se toca monto, cuotas o
  // linea.
  const [cuotaObjetivoTexto, setCuotaObjetivoTexto] = useState<string | null>(
    null,
  );
  const [cuotaAnterior, setCuotaAnterior] = useState<{
    condicionesKey: string;
    valor: number;
  } | null>(null);
  const condicionesKey = JSON.stringify([
    selectedLinea?.oid,
    parseMoneyValue(monto),
    Number(cuotas),
    fecha || "",
  ]);
  // Una cuota anterior solo es vigente para la misma linea, monto, cuotas y fecha.
  const cuotaVigente =
    cuotaAnterior?.condicionesKey === condicionesKey
      ? cuotaAnterior.valor
      : null;
  const cuotaObjetivo =
    cuotaObjetivoTexto !== null ? parseMoneyValue(cuotaObjetivoTexto) : null;
  const calculo = useCuotaCalculada(
    {
      ...(cuotaObjetivo !== null && cuotaObjetivo > 0 ? { cuotaObjetivo } : {}),
      capitalPuro: false,
      lineaId: Number(selectedLinea?.oid),
      // Con cuota objetivo el monto lo busca el legado; la API igual pide uno
      // positivo, asi que sin monto cargado va el maximo de la linea.
      montoAFinanciar:
        cuotaObjetivo !== null
          ? parseMoneyValue(monto) || (selectedLinea?.montoMaximo ?? 1)
          : parseMoneyValue(ajustarMontoTexto(monto, selectedLinea)),
      cuotas: Number(ajustarCuotasTexto(cuotas, selectedLinea)),
      ...(fecha ? { fechaPrimerVencimiento: fecha } : {}),
    },
    Boolean(
      selectedLinea?.oid &&
      Number(cuotas) > 0 &&
      (cuotaObjetivo !== null ? cuotaObjetivo > 0 : parseMoneyValue(monto) > 0),
    ),
    (result) => {
      // Con cuota objetivo, que cambie el monto es el resultado, no un ajuste
      // por los maximos de la linea.
      if (
        (cuotaObjetivo === null &&
          parseMoneyValue(form.getValues("montoAFinanciar")) !==
            result.montoAFinanciar) ||
        Number(form.getValues("cuotas")) !== result.cuotas
      )
        onLimitsAdjusted?.();
      if (
        parseMoneyValue(form.getValues("montoAFinanciar")) !==
        result.montoAFinanciar
      )
        form.setValue(
          "montoAFinanciar",
          formatMoneyAmount(result.montoAFinanciar),
        );
      if (Number(form.getValues("cuotas")) !== result.cuotas)
        form.setValue("cuotas", String(result.cuotas));
    },
    // Un error no confirma el monto de una cuota solicitada, aunque el backend
    // incluya valores efectivos. Conservar las condiciones vigentes.
    { applyEffectiveValuesOnError: cuotaObjetivo === null },
  );
  useEffect(() => {
    form.setValue(
      "cuotaResultante",
      calculo.data
        ? formatDecimalMoneyValue(calculo.data.cuotaResultante)
        : calculo.isPending
          ? "Calculando..."
          : calculo.error
            ? "No se pudo calcular"
            : "",
    );
  }, [form, calculo.data, calculo.isPending, calculo.error]);
  const currentEstado = currentEstadoValue?.trim() || "Sin estado";
  const cuotaVigenteTexto =
    cuotaVigente !== null ? formatDecimalMoneyValue(cuotaVigente) : "";
  const condicionesVigentes = `Se mantienen ${formatMoneyAmount(parseMoneyValue(monto))} en ${cuotas} cuotas${cuotaVigente !== null ? ` de ${formatMoneyAmount(cuotaVigente)}` : ""}.`;
  const cuotaCalculo = {
    // Al fallar, mostrar la cuota vigente; lo solicitado se conserva en el
    // aviso y se puede reintentar sin impedir guardar otros datos.
    valor: calculo.data
      ? formatDecimalMoneyValue(calculo.data.cuotaResultante)
      : calculo.error && cuotaObjetivo !== null
        ? cuotaVigenteTexto
        : (cuotaObjetivoTexto ?? cuotaVigenteTexto),
    mensaje:
      cuotaObjetivo !== null && cuotaObjetivo <= 0
        ? `Ingresá una cuota mayor a cero. La cuota ingresada no se aplicó. ${condicionesVigentes}`
        : calculo.isPending
          ? cuotaObjetivo !== null
            ? `Calculando el monto para una cuota de ${formatMoneyAmount(cuotaObjetivo)}. Hasta confirmar, estas son las condiciones vigentes: ${condicionesVigentes}`
            : "Calculando..."
          : calculo.error
            ? cuotaObjetivo !== null
              ? `No se pudo aplicar la cuota de ${formatMoneyAmount(cuotaObjetivo)}. ${calculo.error.message} ${condicionesVigentes}`
              : calculo.error.message
            : cuotaObjetivo !== null && calculo.data
              ? "Monto calculado a partir de la cuota."
              : null,
    onCuotaChange: (value: string) => {
      if (calculo.data) {
        setCuotaAnterior({
          condicionesKey,
          valor: calculo.data.cuotaResultante,
        });
      } else if (cuotaObjetivoTexto === null) {
        setCuotaAnterior(null);
      }
      setCuotaObjetivoTexto(value);
    },
    onDatosChange: () => {
      setCuotaObjetivoTexto(null);
      setCuotaAnterior(null);
    },
    onGuardar: () => {
      if (cuotaObjetivoTexto !== null && calculo.isPending) {
        // Cancelar antes de armar el payload: una respuesta tardia no debe
        // cambiar el monto del formulario despues de enviar la solicitud.
        // Conservar la cuota solicitada para poder reintentar si hace falta.
        calculo.cancel(
          new Error("Se conservan las condiciones vigentes al guardar."),
        );
      }
    },
    onReintentar:
      cuotaObjetivo !== null && cuotaObjetivo > 0 && calculo.error
        ? calculo.recalculate
        : undefined,
  };

  return {
    ...form,
    cuotaCalculo,
    currentEstado,
    errors: form.formState.errors,
    estadoCivilOptions: ESTADO_CIVIL_OPTIONS,
    selectedLinea,
    sexoConyugeOptions: SEXO_OPTIONS,
    sexoOptions: SEXO_OPTIONS,
  };
}
