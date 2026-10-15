import { Eye, X } from "lucide-react";
import { AdjuntoPreviewContent } from "./AdjuntoPreviewContent";

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
          {open && file ? (
            <AdjuntoPreviewContent
              key={`${file.name}-${file.lastModified}`}
              file={file}
            />
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
