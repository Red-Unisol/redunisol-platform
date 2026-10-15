import { Download, ExternalLink, Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/shared/components/ui/button";

/** Native PDF viewer retains selectable text, page navigation and independent zoom. */
export function AdjuntoPreviewContent({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setUrl(objectUrl);
        setZoom(100);
      }
    });
    return () => {
      active = false;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  const image = file.type.startsWith("image/");
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
        <Button asChild disabled={!url} size="sm" variant="outline">
          <a href={url ?? undefined} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" />
            Abrir en otra pestaña
          </a>
        </Button>
        <Button asChild disabled={!url} size="sm" variant="outline">
          <a href={url ?? undefined} download={file.name}>
            <Download className="size-4" />
            Descargar
          </a>
        </Button>
        {image ? (
          <>
            <Button
              aria-label="Reducir zoom del recibo"
              size="icon-sm"
              variant="outline"
              disabled={zoom <= 25}
              onClick={() => setZoom((value) => Math.max(25, value - 25))}
            >
              <Minus className="size-4" />
            </Button>
            <span className="text-xs">{zoom}%</span>
            <Button
              aria-label="Ampliar zoom del recibo"
              size="icon-sm"
              variant="outline"
              disabled={zoom >= 300}
              onClick={() => setZoom((value) => Math.min(300, value + 25))}
            >
              <Plus className="size-4" />
            </Button>
          </>
        ) : null}
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto bg-background/50"
        tabIndex={0}
        aria-label="Contenido del documento"
      >
        {url ? (
          image ? (
            <img
              alt={file.name}
              src={url}
              className="max-w-none"
              style={{ width: `${zoom}%` }}
            />
          ) : file.type === "application/pdf" ? (
            <iframe
              src={`${url}#navpanes=0&zoom=125`}
              title={file.name}
              className="h-full min-h-64 w-full border-none"
            />
          ) : (
            <p className="p-4 text-sm">
              Vista previa no disponible para este tipo de archivo. Podés
              abrirlo o descargarlo.
            </p>
          )
        ) : (
          <p className="p-4 text-sm">Cargando documento...</p>
        )}
      </div>
    </div>
  );
}
