import { ApiError } from "@/shared/services/http/api-error";
import { useEffect, useRef, useState } from "react";
import { simularPrestamo } from "../services/solicitudes-core-api";
import type {
  SimulacionPrestamoResponse,
  SimularPrestamoRequest,
} from "@/modules/solicitudes/types/solicitudes-core";

export function useCuotaCalculada(
  input: SimularPrestamoRequest,
  enabled: boolean,
  onResolved?: (
    result: Pick<SimulacionPrestamoResponse, "montoAFinanciar" | "cuotas">,
  ) => void,
  options: { applyEffectiveValuesOnError?: boolean } = {},
) {
  const applyEffectiveValuesOnError = options.applyEffectiveValuesOnError ?? true;
  const key = JSON.stringify(input);
  const callback = useRef(onResolved);
  useEffect(() => {
    callback.current = onResolved;
  });
  const completed = useRef<string | null>(null);
  const cancelPending = useRef<(() => void) | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data?: SimulacionPrestamoResponse;
    error?: Error;
  }>({ key: "" });
  const [lastEnabled, setLastEnabled] = useState(enabled);
  if (lastEnabled !== enabled) {
    setLastEnabled(enabled);
    setState({ key: "" });
  }
  useEffect(() => {
    if (!enabled) {
      completed.current = null;
      return;
    }
    if (completed.current === key) return;
    completed.current = null;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const payload = JSON.parse(key) as SimularPrestamoRequest;
        const result = await simularPrestamo(payload);
        if (cancelled) return;
        const effectiveKey = JSON.stringify({
          ...payload,
          cuotas: result.cuotas,
          montoAFinanciar: result.montoAFinanciar,
        });
        completed.current = effectiveKey;
        setState({ key: effectiveKey, data: result });
        callback.current?.(result);
      } catch (error) {
        if (cancelled) return;
        let effectiveKey = key;
        if (
          applyEffectiveValuesOnError &&
          error instanceof ApiError &&
          error.code === "CALCULO_CON_VALORES_EFECTIVOS" &&
          error.rawBody
        ) {
          try {
            const values = JSON.parse(error.rawBody).effectiveValues as {
              montoAFinanciar: number;
              cuotas: number;
            };
            if (
              Number.isFinite(values.montoAFinanciar) &&
              values.montoAFinanciar > 0 &&
              Number.isSafeInteger(values.cuotas) &&
              values.cuotas > 0
            ) {
              effectiveKey = JSON.stringify({
                ...JSON.parse(key),
                cuotas: values.cuotas,
                montoAFinanciar: values.montoAFinanciar,
              });
              completed.current = effectiveKey;
              callback.current?.(values);
            }
          } catch {
            /* Una respuesta de error sin datos efectivos no cambia los campos. */
          }
        }
        setState({
          key: effectiveKey,
          error:
            error instanceof Error
              ? error
              : new Error("No se pudo calcular la cuota."),
        });
      }
    }, 400);
    const cancel = () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    cancelPending.current = cancel;
    return cancel;
  }, [key, enabled, attempt, applyEffectiveValuesOnError]);
  const current = enabled && state.key === key;
  return {
    cancel: (error?: Error) => {
      cancelPending.current?.();
      completed.current = null;
      setState({ key, error });
    },
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    isPending: enabled && (!current || (!state.data && !state.error)),
    recalculate: () => {
      completed.current = null;
      setState({ key: "" });
      setAttempt((n) => n + 1);
    },
  };
}
