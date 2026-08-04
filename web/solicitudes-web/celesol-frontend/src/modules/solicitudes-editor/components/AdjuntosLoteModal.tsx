import { CircleAlert, Paperclip, X } from "lucide-react";
import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import { useTiposAdjuntoQuery } from "@/modules/solicitudes-core/hooks/use-tipos-adjunto-query";
import { Button } from "@/shared/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";

import {
  AdjuntoLoteItemRow,
  type PendingAdjuntoLoteItem,
} from "./AdjuntoLoteItemRow";
import { ModalSection, legacyFieldClassName } from "./fields/base";

const MAX_ADJUNTOS_LOTE = 10;

export type AdjuntoLoteItem = {
  file: File;
  tipoAdjunto: string;
};

export function AdjuntosLoteModal({
  isSaving = false,
  onOpenChange,
  onSave,
  open,
}: {
  isSaving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (items: AdjuntoLoteItem[]) => Promise<boolean>;
  open: boolean;
}) {
  const [items, setItems] = useState<PendingAdjuntoLoteItem[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [dropWarning, setDropWarning] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: tiposAdjunto = [] } = useTiposAdjuntoQuery();

  function resetDraft() {
    setItems([]);
    setIsDragActive(false);
    setDropWarning(null);
    setSaveError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetDraft();
    }

    onOpenChange(nextOpen);
  }

  function addFiles(files: File[]) {
    if (isSaving || files.length === 0) {
      return;
    }

    const availableSlots = MAX_ADJUNTOS_LOTE - items.length;
    const filesToAdd = files.slice(0, Math.max(0, availableSlots));

    if (filesToAdd.length < files.length) {
      setDropWarning(
        filesToAdd.length === 0
          ? `No se agrego ningun archivo nuevo. Ya alcanzaste el maximo de ${MAX_ADJUNTOS_LOTE}.`
          : `Se agregaron ${filesToAdd.length} de ${files.length} archivos. Alcanzaste el maximo de ${MAX_ADJUNTOS_LOTE}.`,
      );
    } else {
      setDropWarning(null);
    }

    if (filesToAdd.length === 0) {
      return;
    }

    setItems((current) => [
      ...current,
      ...filesToAdd.map((file) => ({
        file,
        id: crypto.randomUUID(),
        tipoAdjunto: "",
      })),
    ]);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function hasDraggedFiles(event: DragEvent<HTMLDivElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (isSaving || !hasDraggedFiles(event)) {
      return;
    }

    setIsDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (isSaving || !hasDraggedFiles(event)) {
      return;
    }

    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);

    if (isSaving) {
      return;
    }

    addFiles(Array.from(event.dataTransfer.files));
  }

  function handleDropzoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isSaving) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  }

  function handleRemoveItem(id: string) {
    if (isSaving) {
      return;
    }

    setDropWarning(null);
    setSaveError(null);
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function handleTipoAdjuntoChange(id: string, tipoAdjunto: string) {
    setSaveError(null);
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, tipoAdjunto } : item)),
    );
  }

  const canAddMore = items.length < MAX_ADJUNTOS_LOTE;
  const canSave =
    items.length > 0 &&
    items.every((item) => item.tipoAdjunto.trim().length > 0) &&
    !isSaving;

  async function handleSave() {
    if (!canSave) {
      return;
    }

    setSaveError(null);

    const saved = await onSave(
      items.map(({ file, tipoAdjunto }) => ({ file, tipoAdjunto })),
    );

    if (saved) {
      resetDraft();
    } else {
      setSaveError(
        "No se pudo guardar el lote de adjuntos. Los archivos y sus clasificaciones se mantienen: revisa los datos e intenta guardar de nuevo.",
      );
    }
  }

  return (
    <DialogRoot onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] max-w-[800px] flex-col overflow-hidden p-0">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-background text-foreground-secondary">
              <Paperclip className="size-4" />
            </span>
            <DialogTitle className="text-2xl font-semibold leading-none text-foreground">
              Adjuntos Solicitud
            </DialogTitle>
          </div>
          <DialogClose asChild>
            <Button
              className="text-foreground-secondary"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <ModalSection title="Archivos">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground-secondary">
                  Archivos seleccionados: {items.length}/{MAX_ADJUNTOS_LOTE}
                </p>
                <p className="text-xs text-foreground-muted">
                  El tipo de adjunto es obligatorio para cada archivo.
                </p>
              </div>

              {canAddMore ? (
                <div>
                  <input
                    className="hidden"
                    multiple
                    onChange={handleFileInputChange}
                    ref={fileInputRef}
                    type="file"
                  />
                  <div
                    aria-disabled={isSaving}
                    aria-label="Seleccionar archivos"
                    className={`${legacyFieldClassName} min-h-32 cursor-pointer flex-col items-center justify-center gap-2 border-dashed px-4 py-4 text-center ${
                      isSaving
                        ? "cursor-not-allowed opacity-60"
                        : "hover:border-input-focus hover:bg-background"
                    } ${
                      isDragActive
                        ? "border-input-focus bg-background ring-2 ring-input-focus/20"
                        : ""
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onKeyDown={handleDropzoneKeyDown}
                    role="button"
                    tabIndex={isSaving ? -1 : 0}
                  >
                    <span className="inline-flex size-10 items-center justify-center rounded-full bg-background text-foreground-secondary">
                      <Paperclip className="size-5" />
                    </span>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        Seleccionar archivos
                      </p>
                      <p className="text-xs text-foreground-secondary">
                        Arrastrá uno o varios archivos aquí, o hacé clic para
                        seleccionarlos (máximo {MAX_ADJUNTOS_LOTE})
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-foreground-muted">
                  Alcanzaste el maximo de {MAX_ADJUNTOS_LOTE} archivos por
                  carga.
                </p>
              )}

              {dropWarning ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <p>{dropWarning}</p>
                </div>
              ) : null}

              {items.length > 0 ? (
                <div className="space-y-2">
                  {items.map((item) => (
                    <AdjuntoLoteItemRow
                      disabled={isSaving}
                      item={item}
                      key={item.id}
                      onRemove={() => handleRemoveItem(item.id)}
                      onTipoAdjuntoChange={(tipoAdjunto) =>
                        handleTipoAdjuntoChange(item.id, tipoAdjunto)
                      }
                      tiposAdjunto={tiposAdjunto}
                    />
                  ))}
                </div>
              ) : null}

              {saveError ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <p>{saveError}</p>
                </div>
              ) : null}
            </div>
          </ModalSection>
        </div>

        <footer className="shrink-0 border-t border-border bg-surface px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <Button
              disabled={!canSave}
              onClick={() => void handleSave()}
              type="button"
            >
              {isSaving ? "Guardando..." : "Guardar"}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
          </div>
        </footer>
      </DialogContent>
    </DialogRoot>
  );
}
