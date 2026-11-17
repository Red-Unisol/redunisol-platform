import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  listarVersionesCalculadora,
  type CalculadoraVersion,
} from "../services/riesgo-api";

type CalculadoraVersionLineaProps = {
  /** Abre la ventana de versiones (vista previa, historial, volver atras). */
  onAbrir: () => void;
  /** Cambia cuando se aplica o restaura una version, para volver a leer. */
  recarga?: number;
};

function formatFecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

function describirVersion(version: CalculadoraVersion | null) {
  if (!version || version.origen === "REPOSITORIO") {
    return "Versión incluida en Sol Web";
  }
  const quien = version.cargadaPor ? ` · ${version.cargadaPor.nombre}` : "";
  if (version.origen === "RESTAURADA") {
    return `Versión restaurada el ${formatFecha(version.cargadaEn)}${quien}`;
  }
  return `Versión del ${formatFecha(version.cargadaEn)}${quien}`;
}

/**
 * Una linea chica en gris con la version vigente de la calculadora y un link
 * para buscar la ultima de Vimarx. No ocupa una franja propia.
 */
export function CalculadoraVersionLinea({
  onAbrir,
  recarga = 0,
}: CalculadoraVersionLineaProps) {
  const [vigente, setVigente] = useState<CalculadoraVersion | null>(null);
  const [cargada, setCargada] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const versiones = await listarVersionesCalculadora();
      setVigente(versiones.find((version) => version.vigente) ?? null);
    } catch {
      // Sin la linea la calculadora sigue andando: no se muestra error.
      setVigente(null);
    } finally {
      setCargada(true);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar, recarga]);

  if (!cargada) {
    return null;
  }

  return (
    <p className="mt-1 flex items-center gap-1.5 text-xs text-foreground-secondary">
      <span>{describirVersion(vigente)}</span>
      <span aria-hidden="true">·</span>
      <button
        className="inline-flex items-center gap-1 text-xs text-foreground-secondary underline-offset-2 hover:text-foreground hover:underline"
        onClick={onAbrir}
        type="button"
      >
        <RefreshCw aria-hidden="true" className="size-3" />
        Buscar actualización
      </button>
    </p>
  );
}
