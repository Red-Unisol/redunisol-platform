import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { AdjuntoPreviewContent } from "@/modules/solicitudes-editor/components/AdjuntoPreviewContent";
import type { SolicitudCoreAdjuntoResponse } from "@/modules/solicitudes/types/solicitudes-core";
import { downloadSolicitudCoreAdjunto } from "../services/solicitudes-core-api";

function ReciboDocumento({
  solicitudId,
  adjunto,
}: {
  solicitudId: string;
  adjunto: SolicitudCoreAdjuntoResponse;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    downloadSolicitudCoreAdjunto(solicitudId, adjunto.id, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setFile(
          new File(
            [response.blob],
            response.fileName ?? adjunto.archivoNombre ?? "Recibo de sueldo",
            { type: response.contentType ?? response.blob.type },
          ),
        );
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "No se pudo obtener el recibo.",
          );
      });
    return () => controller.abort();
  }, [solicitudId, adjunto.id, adjunto.archivoNombre, attempt]);
  if (error)
    return (
      <div role="alert" className="p-3 text-sm">
        <p>{error}</p>
        <Button
          className="mt-2"
          variant="outline"
          onClick={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        >
          Reintentar
        </Button>
      </div>
    );
  if (!file)
    return (
      <p role="status" className="p-3 text-sm">
        Cargando recibo de sueldo...
      </p>
    );
  return <AdjuntoPreviewContent file={file} />;
}

export function EvaluacionRecibosView({
  children,
  solicitudId,
  recibos,
  open,
  selectedId,
  onSelect,
  onOpen,
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
  onOpen: () => void;
  onClose: () => void;
  loading: boolean;
  error: string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [leftPercent, setLeftPercent] = useState(65);
  const index = Math.max(
    0,
    recibos.findIndex((item) => item.id === selectedId),
  );
  const selected = recibos[index];
  const changeWidth = (value: number) =>
    setLeftPercent(Math.max(35, Math.min(75, value)));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
        <Button variant="outline" size="sm" onClick={onOpen}>
          Ver recibos de sueldo
        </Button>
        {open ? (
          <Button variant="outline" size="sm" onClick={onClose}>
            Cerrar recibos
          </Button>
        ) : null}
        {open && recibos.length > 1 ? (
          <label className="flex min-w-0 items-center gap-2 text-sm">
            Recibo de sueldo
            <select
              aria-label="Seleccionar recibo de sueldo"
              className="max-w-64 rounded border border-border bg-background p-1"
              value={selected?.id ?? ""}
              onChange={(event) => onSelect(event.target.value)}
            >
              {recibos.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.archivoNombre ?? "Recibo de sueldo"}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 overflow-x-auto">
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
                aria-valuemax={75}
                aria-valuenow={leftPercent}
                tabIndex={0}
                className="z-10 w-2 shrink-0 touch-none cursor-col-resize bg-border focus-visible:bg-primary focus-visible:outline-none"
                onKeyDown={(event) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  ) {
                    event.preventDefault();
                    changeWidth(
                      event.key === "Home"
                        ? 35
                        : event.key === "End"
                          ? 75
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
                    changeWidth(
                      ((event.clientX - rect.left) / rect.width) * 100,
                    );
                }}
                onPointerUp={(event) =>
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
              />
              <aside
                aria-label="Recibos de sueldo"
                className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-border"
              >
                <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
                  <p className="min-w-0 flex-1 break-all text-sm font-medium">
                    {selected?.archivoNombre ?? "Recibos de sueldo"}
                  </p>
                  <Button
                    aria-label="Cerrar visor de recibos"
                    size="icon-sm"
                    variant="ghost"
                    onClick={onClose}
                  >
                    <X className="size-4" />
                  </Button>
                  {recibos.length > 1 ? (
                    <div className="flex w-full flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={index === 0}
                        onClick={() => onSelect(recibos[index - 1].id)}
                      >
                        Anterior
                      </Button>
                      <span aria-live="polite" className="text-xs">
                        Recibo {index + 1} de {recibos.length}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={index === recibos.length - 1}
                        onClick={() => onSelect(recibos[index + 1].id)}
                      >
                        Siguiente
                      </Button>
                    </div>
                  ) : null}
                </header>
                <div className="min-h-0 flex-1">
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
                  ) : (
                    <ReciboDocumento
                      key={`${solicitudId}:${selected.id}`}
                      solicitudId={solicitudId}
                      adjunto={selected}
                    />
                  )}
                </div>
              </aside>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
