import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";

import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";

import { formatMoneyValue } from "@/shared/utils/money-format";

import {
  ESTADO_CIVIL_OPTIONS,
  SEXO_OPTIONS,
} from "../constants/legacy-options";
import { NUEVA_SOLICITUD_DEFAULT_VALUES } from "../constants/solicitud-default-values";
import type { NuevaSolicitudFormValues } from "../types";

export function useSolicitudEditorForm(lineas: LineaPrestamoPresolicitud[]) {
  const form = useForm<NuevaSolicitudFormValues>({
    defaultValues: NUEVA_SOLICITUD_DEFAULT_VALUES,
  });
  const [currentEstadoValue, selectedLineaDescripcion] = useWatch({
    control: form.control,
    name: ["estado", "linea"],
  });
  const selectedLinea = useMemo(
    () =>
      lineas.find(
        (linea) => (linea.descripcion ?? "") === selectedLineaDescripcion,
      ),
    [lineas, selectedLineaDescripcion],
  );

  useEffect(() => {
    const nextLineaPrestamoLegacyOid = selectedLinea?.oid ?? "";
    const currentLineaPrestamoLegacyOid = form.getValues(
      "lineaPrestamoLegacyOid",
    );

    if (currentLineaPrestamoLegacyOid === nextLineaPrestamoLegacyOid) {
      return;
    }

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

    // Only re-prefill fields the user hasn't touched themselves. A field set
    // by this effect stays non-dirty (shouldDirty: false), so switching
    // linea keeps re-syncing it to the newly selected linea's max values;
    // once the user edits a field by hand, react-hook-form marks it dirty
    // and this effect stops overwriting it.
    const { dirtyFields } = form.formState;

    if (
      typeof selectedLinea.montoMaximo === "number" &&
      !dirtyFields.montoAFinanciar
    ) {
      form.setValue(
        "montoAFinanciar",
        formatMoneyValue(String(selectedLinea.montoMaximo)),
        {
          shouldDirty: false,
          shouldTouch: false,
          shouldValidate: false,
        },
      );
    }

    if (
      typeof selectedLinea.cantidadMaximaCuotas === "number" &&
      !dirtyFields.cuotas
    ) {
      form.setValue("cuotas", String(selectedLinea.cantidadMaximaCuotas), {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [form, selectedLinea]);

  const currentEstado = currentEstadoValue?.trim() || "Sin estado";

  return {
    ...form,
    currentEstado,
    errors: form.formState.errors,
    estadoCivilOptions: ESTADO_CIVIL_OPTIONS,
    selectedLinea,
    sexoConyugeOptions: SEXO_OPTIONS,
    sexoOptions: SEXO_OPTIONS,
  };
}
