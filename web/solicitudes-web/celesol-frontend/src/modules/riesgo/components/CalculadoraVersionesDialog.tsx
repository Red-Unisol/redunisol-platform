import { useEffect, useState } from "react";

import { Button } from "@/shared/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ApiError } from "@/shared/services/http/api-error";

import {
  aplicarVersionCalculadora,
  listarVersionesCalculadora,
  previsualizarVersionCalculadora,
  restaurarVersionCalculadora,
  type CalculadoraVersion,
  type VistaPreviaCalculadora,
} from "../services/riesgo-api";

type CalculadoraVersionesDialogProps = {
  abierta: boolean;
  onAbiertaChange: (abierta: boolean) => void;
  /** Se aplico o restauro una version: hay que volver a cargar la planilla. */
  onVersionCambiada: () => void;
};

function mensajeDeError(error: unknown, porDefecto: string) {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : porDefecto;
}

function formatFechaHora(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function describirOrigen(version: CalculadoraVersion) {
  if (version.origen === "REPOSITORIO") {
    return "Incluida en Sol Web";
  }
  if (version.origen === "RESTAURADA") {
    const desde = (
      version.resumenCambios as { restauradaDe?: { cargadaEn?: string } } | null
    )?.restauradaDe?.cargadaEn;
    return desde
      ? `Vuelta a la del ${formatFechaHora(desde)}`
      : "Vuelta a una anterior";
  }
  return "Traída de Vimarx";
}

function Valor({ valor }: { valor: string }) {
  return valor === "" ? (
    <span className="italic text-foreground-secondary">(vacía)</span>
  ) : (
    <span className="break-all">{valor}</span>
  );
}

/**
 * Ventana de "Buscar actualización": que cambia la ultima planilla de Vimarx
 * respecto de la vigente, aplicarla, y las versiones anteriores para volver.
 */
export function CalculadoraVersionesDialog({
  abierta,
  onAbiertaChange,
  onVersionCambiada,
}: CalculadoraVersionesDialogProps) {
  const [vistaPrevia, setVistaPrevia] = useState<VistaPreviaCalculadora | null>(
    null,
  );
  const [errorVistaPrevia, setErrorVistaPrevia] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [versiones, setVersiones] = useState<CalculadoraVersion[]>([]);
  const [trabajando, setTrabajando] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [aConfirmar, setAConfirmar] = useState<string | null>(null);

  async function buscar() {
    setBuscando(true);
    setErrorVistaPrevia(null);
    setVistaPrevia(null);
    try {
      setVistaPrevia(await previsualizarVersionCalculadora());
    } catch (error) {
      setErrorVistaPrevia(
        mensajeDeError(error, "No se pudo traer la planilla de Vimarx."),
      );
    } finally {
      setBuscando(false);
    }
  }

  async function cargarVersiones() {
    try {
      setVersiones(await listarVersionesCalculadora());
    } catch {
      setVersiones([]);
    }
  }

  useEffect(() => {
    if (!abierta) {
      return;
    }
    setErrorAccion(null);
    setAConfirmar(null);
    void buscar();
    void cargarVersiones();
  }, [abierta]);

  async function ejecutar(accion: () => Promise<unknown>, porDefecto: string) {
    setTrabajando(true);
    setErrorAccion(null);
    try {
      await accion();
      onAbiertaChange(false);
      onVersionCambiada();
    } catch (error) {
      setErrorAccion(mensajeDeError(error, porDefecto));
      // Si cambio algo en Vimarx o en las versiones, se muestra lo actual.
      void buscar();
      void cargarVersiones();
    } finally {
      setTrabajando(false);
      setAConfirmar(null);
    }
  }

  const hayCambios = vistaPrevia !== null && !vistaPrevia.sinCambios;

  return (
    <DialogRoot onOpenChange={onAbiertaChange} open={abierta}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base font-semibold text-foreground">
            Actualizar calculadora
          </DialogTitle>
          <DialogDescription className="text-sm text-foreground-secondary">
            Trae la última planilla SCORINGPF de Vimarx. Las evaluaciones ya
            guardadas no cambian.
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              Cambios en Vimarx
            </h3>

            {buscando ? (
              <p className="text-sm text-foreground-secondary">
                Buscando la última versión en Vimarx...
              </p>
            ) : null}

            {errorVistaPrevia ? (
              <p className="text-sm text-destructive">{errorVistaPrevia}</p>
            ) : null}

            {vistaPrevia?.sinCambios ? (
              <p className="text-sm text-foreground-secondary">
                Ya tenés la última versión de Vimarx.
              </p>
            ) : null}

            {hayCambios ? (
              <div className="space-y-3">
                {vistaPrevia.cambios.hojasNuevas.length > 0 ? (
                  <p className="text-sm">
                    Hojas nuevas: {vistaPrevia.cambios.hojasNuevas.join(", ")}
                  </p>
                ) : null}
                {vistaPrevia.cambios.hojasQuitadas.length > 0 ? (
                  <p className="text-sm">
                    Hojas quitadas:{" "}
                    {vistaPrevia.cambios.hojasQuitadas.join(", ")}
                  </p>
                ) : null}
                {vistaPrevia.cambios.hojas.map((hoja) => (
                  <div key={hoja.hoja}>
                    <p className="mb-1 text-sm font-medium text-foreground">
                      {hoja.hoja}{" "}
                      <span className="font-normal text-foreground-secondary">
                        · {hoja.total} {hoja.total === 1 ? "celda" : "celdas"}
                      </span>
                    </p>
                    <table className="w-full table-fixed border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-border text-left text-foreground-secondary">
                          <th className="w-16 py-1 pr-2 font-medium">Celda</th>
                          <th className="py-1 pr-2 font-medium">Antes</th>
                          <th className="py-1 font-medium">Después</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hoja.celdas.map((celda) => (
                          <tr
                            className="border-b border-border/60 align-top"
                            key={celda.ref}
                          >
                            <td className="py-1 pr-2 font-mono">{celda.ref}</td>
                            <td className="py-1 pr-2">
                              <Valor valor={celda.antes} />
                            </td>
                            <td className="py-1">
                              <Valor valor={celda.despues} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {hoja.total > hoja.celdas.length ? (
                      <p className="mt-1 text-xs text-foreground-secondary">
                        y {hoja.total - hoja.celdas.length} más.
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {versiones.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">
                Versiones
              </h3>
              <ul className="divide-y divide-border/60 text-sm">
                {versiones.map((version) => (
                  <li
                    className="flex items-center justify-between gap-3 py-1.5"
                    key={version.id}
                  >
                    <span className="min-w-0 truncate">
                      {formatFechaHora(version.cargadaEn)}
                      {version.cargadaPor ? ` · ${version.cargadaPor.nombre}` : ""}
                      <span className="text-foreground-secondary">
                        {" "}
                        · {describirOrigen(version)}
                      </span>
                    </span>
                    {version.vigente ? (
                      <span className="shrink-0 text-xs font-medium text-foreground-secondary">
                        En uso
                      </span>
                    ) : aConfirmar === version.id ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <Button
                          disabled={trabajando}
                          onClick={() =>
                            void ejecutar(
                              () => restaurarVersionCalculadora(version.id),
                              "No se pudo volver a esa versión.",
                            )
                          }
                          size="xs"
                        >
                          Confirmar
                        </Button>
                        <Button
                          disabled={trabajando}
                          onClick={() => setAConfirmar(null)}
                          size="xs"
                          variant="ghost"
                        >
                          No
                        </Button>
                      </span>
                    ) : (
                      <button
                        className="shrink-0 text-xs text-foreground-secondary underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                        disabled={trabajando}
                        onClick={() => setAConfirmar(version.id)}
                        type="button"
                      >
                        Volver a esta
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {errorAccion ? (
            <p className="mr-auto text-sm text-destructive">{errorAccion}</p>
          ) : null}
          <DialogClose asChild>
            <Button disabled={trabajando} size="sm" variant="outline">
              {hayCambios ? "Cancelar" : "Cerrar"}
            </Button>
          </DialogClose>
          {hayCambios ? (
            <Button
              disabled={trabajando || buscando}
              onClick={() =>
                void ejecutar(
                  () => aplicarVersionCalculadora(vistaPrevia.huellaVimarx),
                  "No se pudo actualizar la calculadora.",
                )
              }
              size="sm"
            >
              {trabajando ? "Actualizando..." : "Actualizar calculadora"}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
