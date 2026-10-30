import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import type { SolicitudCoreAdjuntoResponse } from "@/modules/solicitudes/types/solicitudes-core";
import { downloadSolicitudCoreAdjunto } from "../services/solicitudes-core-api";

// Altura comun de la franja de la calculadora y la del recibo: una sola linea
// de acciones arriba de cada mitad.
export const FRANJA_EVALUACION =
  "flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface px-3";

const ZOOM_MIN = 50;
const ZOOM_MAX = 300;
const ZOOM_PASO = 25;

function useReciboArchivo(
  solicitudId: string,
  adjunto: SolicitudCoreAdjuntoResponse | undefined,
) {
  const [estado, setEstado] = useState<{
    clave: string;
    file: File | null;
    error: string | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const adjuntoId = adjunto?.id;
  const nombre = adjunto?.archivoNombre;
  const clave = adjuntoId ? `${adjuntoId}:${attempt}` : "";

  useEffect(() => {
    if (!adjuntoId) return;
    const controller = new AbortController();
    downloadSolicitudCoreAdjunto(solicitudId, adjuntoId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setEstado({
          clave,
          error: null,
          file: new File(
            [response.blob],
            response.fileName ?? nombre ?? "Recibo de sueldo",
            { type: response.contentType ?? response.blob.type },
          ),
        });
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setEstado({
          clave,
          error:
            reason instanceof Error
              ? reason.message
              : "No se pudo obtener el recibo.",
          file: null,
        });
      });
    return () => controller.abort();
  }, [solicitudId, adjuntoId, nombre, clave]);

  const actual = estado?.clave === clave ? estado : null;
  const file = actual?.file ?? null;

  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    queueMicrotask(() => setUrl(objectUrl));
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [file]);

  return {
    error: actual?.error ?? null,
    file,
    reintentar: () => setAttempt((value) => value + 1),
    url: file ? url : null,
  };
}

export function EvaluacionRecibosView({
  children,
  solicitudId,
  recibos,
  open,
  selectedId,
  onSelect,
  onClose,
  loading,
  error,
}: {
  children: ReactNode;
  solicitudId: string;
  recibos: SolicitudCoreAdjuntoResponse[];
  open: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  loading: boolean;
  error: string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  // Mitad y mitad; se puede correr la division a mano.
  const [leftPercent, setLeftPercent] = useState(50);
  const [zoom, setZoom] = useState(100);
  const index = Math.max(
    0,
    recibos.findIndex((item) => item.id === selectedId),
  );
  const selected = open ? recibos[index] : undefined;
  const recibo = useReciboArchivo(solicitudId, selected);
  const esImagen = recibo.file?.type.startsWith("image/") ?? false;
  const esPdf = recibo.file?.type === "application/pdf";
  const changeWidth = (value: number) => {
    setLeftPercent(Math.max(35, Math.min(65, value)));
  };
  const cambiarRecibo = (id: string) => {
    setZoom(100);
    onSelect(id);
  };

  return (
    <div className="flex min-h-72 min-w-0 flex-1 overflow-x-auto">
      <div
        ref={container}
        className={`flex min-h-0 flex-1 ${open ? "min-w-[680px]" : "min-w-0"}`}
      >
        <div
          id="evaluacion-panel"
          className="flex min-h-0 min-w-0 flex-col"
          style={{ width: open ? `${leftPercent}%` : "100%" }}
        >
          {children}
        </div>
        {open ? (
          <>
            <div
              role="separator"
              aria-label="Ajustar ancho de Evaluación y recibo"
              aria-orientation="vertical"
              aria-controls="evaluacion-panel"
              aria-valuemin={35}
              aria-valuemax={65}
              aria-valuenow={leftPercent}
              tabIndex={0}
              className="z-10 w-1.5 shrink-0 touch-none cursor-col-resize bg-border hover:bg-verde/40 focus-visible:bg-verde focus-visible:outline-none"
              onDoubleClick={() => setLeftPercent(50)}
              onKeyDown={(event) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  changeWidth(
                    event.key === "Home"
                      ? 35
                      : event.key === "End"
                        ? 65
                        : leftPercent + (event.key === "ArrowLeft" ? -2 : 2),
                  );
                }
              }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId))
                  return;
                const rect = container.current?.getBoundingClientRect();
                if (rect)
                  changeWidth(((event.clientX - rect.left) / rect.width) * 100);
              }}
              onPointerUp={(event) =>
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
              title="Arrastrá para cambiar el ancho (doble clic: mitad y mitad)"
            />
            <aside
              aria-label="Recibos de sueldo"
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              {/* Una sola franja: que recibo es y todo lo que se le puede hacer. */}
              <header className={FRANJA_EVALUACION}>
                {recibos.length > 1 ? (
                  <div className="flex shrink-0 items-center">
                    <Button
                      aria-label="Recibo anterior"
                      disabled={index === 0}
                      onClick={() => cambiarRecibo(recibos[index - 1].id)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span
                      aria-live="polite"
                      className="text-xs text-foreground-secondary tabular-nums"
                    >
                      {index + 1}/{recibos.length}
                    </span>
                    <Button
                      aria-label="Recibo siguiente"
                      disabled={index === recibos.length - 1}
                      onClick={() => cambiarRecibo(recibos[index + 1].id)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                ) : null}
                <p
                  className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
                  title={selected?.archivoNombre ?? undefined}
                >
                  {selected?.archivoNombre ?? "Recibo de sueldo"}
                </p>
                {esImagen || esPdf ? (
                  <div className="flex shrink-0 items-center">
                    <Button
                      aria-label="Achicar el recibo"
                      disabled={zoom <= ZOOM_MIN}
                      onClick={() =>
                        setZoom((value) =>
                          Math.max(ZOOM_MIN, value - ZOOM_PASO),
                        )
                      }
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Minus className="size-4" />
                    </Button>
                    <button
                      className="w-11 text-center text-xs text-foreground-secondary tabular-nums hover:text-foreground"
                      onClick={() => setZoom(100)}
                      title="Volver al ancho de la pantalla"
                      type="button"
                    >
                      {zoom}%
                    </button>
                    <Button
                      aria-label="Agrandar el recibo"
                      disabled={zoom >= ZOOM_MAX}
                      onClick={() =>
                        setZoom((value) =>
                          Math.min(ZOOM_MAX, value + ZOOM_PASO),
                        )
                      }
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                ) : null}
                <Button
                  aria-label="Abrir el recibo en otra pestaña"
                  asChild
                  disabled={!recibo.url}
                  size="icon-sm"
                  title="Abrir en otra pestaña"
                  variant="ghost"
                >
                  <a
                    href={recibo.url ?? undefined}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
                <Button
                  aria-label="Descargar el recibo"
                  asChild
                  disabled={!recibo.url}
                  size="icon-sm"
                  title="Descargar"
                  variant="ghost"
                >
                  <a
                    download={recibo.file?.name}
                    href={recibo.url ?? undefined}
                  >
                    <Download className="size-4" />
                  </a>
                </Button>
                <Button
                  aria-label="Cerrar el recibo"
                  onClick={onClose}
                  size="icon-sm"
                  title="Cerrar el recibo"
                  variant="ghost"
                >
                  <X className="size-4" />
                </Button>
              </header>
              <div
                aria-label="Contenido del recibo"
                className="min-h-0 flex-1 overflow-auto bg-background/50"
                tabIndex={0}
              >
                {loading ? (
                  <p role="status" className="p-3 text-sm">
                    Cargando listado de recibos...
                  </p>
                ) : error ? (
                  <p role="alert" className="p-3 text-sm">
                    {error}
                  </p>
                ) : !selected ? (
                  <p className="p-3 text-sm">
                    No hay recibos de sueldo disponibles.
                  </p>
                ) : recibo.error ? (
                  <div role="alert" className="p-3 text-sm">
                    <p>{recibo.error}</p>
                    <Button
                      className="mt-2"
                      onClick={recibo.reintentar}
                      variant="outline"
                    >
                      Reintentar
                    </Button>
                  </div>
                ) : !recibo.url ? (
                  <p role="status" className="p-3 text-sm">
                    Cargando recibo de sueldo...
                  </p>
                ) : esImagen ? (
                  <img
                    alt={recibo.file?.name ?? "Recibo de sueldo"}
                    className="max-w-none"
                    src={recibo.url}
                    style={{ width: `${zoom}%` }}
                  />
                ) : esPdf ? (
                  // Sin la barra del visor del navegador: el recibo solo se
                  // mira. El zoom lo maneja la franja de arriba.
                  <iframe
                    className="h-full min-h-64 w-full border-none"
                    key={`${recibo.url}:${zoom}`}
                    src={`${recibo.url}#toolbar=0&navpanes=0&statusbar=0&${
                      zoom === 100 ? "view=FitH" : `zoom=${zoom}`
                    }`}
                    title={recibo.file?.name ?? "Recibo de sueldo"}
                  />
                ) : (
                  <p className="p-4 text-sm">
                    Vista previa no disponible para este tipo de archivo. Podés
                    abrirlo o descargarlo.
                  </p>
                )}
              </div>
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
