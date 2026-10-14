import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  analizarRecibo,
  getConfiguracionReconocimiento,
} from "../services/reconocimiento-recibos-api";
import {
  ReconocimientoRecibosDraft,
  type EstadoAnalisis,
} from "../utils/reconocimiento-recibos-draft";
export function useReconocimientoRecibos(open: boolean) {
  const { id } = useParams<{ id: string }>();
  const [estados, setEstados] = useState<Record<string, EstadoAnalisis>>({});
  const draft = useMemo(
    () =>
      new ReconocimientoRecibosDraft(
        {
          config: getConfiguracionReconocimiento,
          analyze: (file, signal) => analizarRecibo(file, id, signal),
        },
        (key, estado) =>
          setEstados((current) => ({ ...current, [key]: estado })),
      ),
    [id],
  );
  useEffect(() => {
    if (!open) {
      draft.cancelAll();
      return;
    }
    const timer = window.setInterval(() => {
      void draft.refreshConfig();
    }, 2000);
    return () => {
      window.clearInterval(timer);
      draft.cancelAll();
    };
  }, [draft, open]);
  return { draft, estados, contexto: id ?? "alta" };
}
