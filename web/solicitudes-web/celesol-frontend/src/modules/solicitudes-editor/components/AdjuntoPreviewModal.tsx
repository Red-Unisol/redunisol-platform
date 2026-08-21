import { Download, ExternalLink, Eye, FileText, X } from "lucide-react";
import { useEffect, useMemo } from "react";

import { Button } from "@/shared/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AdjuntoPreviewModal({
  file,
  open,
  onOpenChange,
}: {
  file: File | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const objectUrl = useMemo(() => {
    if (!open || !file) {
      return null;
    }
    return URL.createObjectURL(file);
  }, [open, file]);

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  function handleDownload() {
    if (!objectUrl || !file) return;
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = file.name;
    a.click();
  }

  const isImage = file?.type.startsWith("image/") ?? false;
  const isPdf = file?.type === "application/pdf";

  return (
    <DialogRoot onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] max-w-[1200px] flex-col overflow-hidden p-0">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-foreground-secondary">
              <Eye className="size-4" />
            </span>
            <DialogTitle className="truncate text-2xl font-semibold leading-none text-foreground">
              {file?.name ?? "Vista previa"}
            </DialogTitle>
          </div>
          <DialogClose asChild>
            <Button
              className="ml-2 shrink-0 text-foreground-secondary"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          {objectUrl && file ? (
            isImage ? (
              <div className="flex h-full items-center justify-center bg-background/50 p-4">
                <img
                  alt={file.name}
                  className="max-h-full max-w-full rounded object-contain"
                  src={objectUrl}
                />
              </div>
            ) : isPdf ? (
              <iframe
                className="h-full w-full border-none"
                src={objectUrl}
                title={file.name}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 bg-background/50 p-8">
                <span className="inline-flex size-16 items-center justify-center rounded-full border border-border bg-surface text-foreground-muted">
                  <FileText className="size-8" />
                </span>
                <div className="text-center">
                  <p className="font-medium text-foreground">{file.name}</p>
                  <p className="mt-1 text-sm text-foreground-secondary">
                    {file.type || "Tipo desconocido"} ·{" "}
                    {formatFileSize(file.size)}
                  </p>
                  <p className="mt-2 text-xs text-foreground-muted">
                    Vista previa no disponible para este tipo de archivo.
                  </p>
                </div>
              </div>
            )
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-foreground-muted">
              Sin archivo seleccionado
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-border bg-surface px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            {file ? (
              <span className="text-sm text-foreground-secondary">
                {formatFileSize(file.size)} · {file.type || "Tipo desconocido"}
              </span>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button
                disabled={!objectUrl}
                onClick={() => objectUrl && window.open(objectUrl, "_blank")}
                type="button"
              >
                <ExternalLink className="size-4" />
                Abrir en nueva pestaña
              </Button>
              <Button
                disabled={!objectUrl}
                onClick={handleDownload}
                type="button"
              >
                <Download className="size-4" />
                Descargar
              </Button>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cerrar
                </Button>
              </DialogClose>
            </div>
          </div>
        </footer>
      </DialogContent>
    </DialogRoot>
  );
}
