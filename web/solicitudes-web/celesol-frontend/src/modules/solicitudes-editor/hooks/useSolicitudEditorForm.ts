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

export function useSolicitudEditorForm(lineas: LineaPrestamoPresolicitud[], onLimitsAdjusted?: () => void) {
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
        (cuotaObjetivo !== null
          ? cuotaObjetivo > 0
          : parseMoneyValue(monto) > 0),
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
  const cuotaCalculo = {
    // El calculo si lo hay y, mientras, lo que esta escribiendo el usuario.
    valor: calculo.data
      ? formatDecimalMoneyValue(calculo.data.cuotaResultante)
      : (cuotaObjetivoTexto ?? ""),
    mensaje:
      cuotaObjetivo !== null && cuotaObjetivo <= 0
        ? "Ingresá una cuota mayor a cero."
        : calculo.isPending
          ? cuotaObjetivo !== null
            ? "Calculando el monto..."
            : "Calculando..."
          : calculo.error
            ? calculo.error.message
            : cuotaObjetivo !== null && calculo.data
              ? "Monto calculado a partir de la cuota."
              : null,
    onCuotaChange: setCuotaObjetivoTexto,
    onDatosChange: () => setCuotaObjetivoTexto(null),
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
