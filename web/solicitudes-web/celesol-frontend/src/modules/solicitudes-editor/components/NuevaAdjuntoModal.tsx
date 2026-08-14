import { ChevronDown, Paperclip, Plus, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import type {
  PatchSolicitudCoreAdjuntoRequest,
  UploadSolicitudCoreAdjuntoRequest,
} from "@/modules/solicitudes/types/solicitudes-core";
import { Button } from "@/shared/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";

import {
  LegacyIconButton,
  ModalField,
  ModalSection,
  legacyFieldClassName,
} from "./fields/base";
import { cn } from "@/shared/utils/cn";

type NuevaAdjuntoModalInitialValues = Omit<
  UploadSolicitudCoreAdjuntoRequest,
  "file"
> & {
  existingFileName?: string;
  file?: File;
};

export function NuevaAdjuntoModal({
  initialValues,
  isSaving = false,
  onOpenChange,
  onSave,
  onSaveEdit,
  open,
}: {
  initialValues?: NuevaAdjuntoModalInitialValues;
  isSaving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (payload: UploadSolicitudCoreAdjuntoRequest) => Promise<boolean>;
  onSaveEdit?: (
    payload: PatchSolicitudCoreAdjuntoRequest & { file: File | null },
  ) => Promise<boolean>;
  open: boolean;
}) {
  const isEditMode = Boolean(onSaveEdit);
  const inputFileRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const fileInputHintId = useId();
  const selectedFileNameId = useId();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [tipoAdjunto, setTipoAdjunto] = useState("");
  const [comentario, setComentario] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);

  useEffect(() => {
    if (open && initialValues) {
      setSelectedFile(isEditMode ? null : (initialValues.file ?? null));
      setDescripcion(initialValues.descripcion ?? "");
      setTipoAdjunto(initialValues.tipoAdjunto ?? "");
      setComentario(initialValues.comentario ?? "");
    }
    // Only re-seed when the modal opens, not on every initialValues reference change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function resetDraft() {
    dragDepthRef.current = 0;
    setIsDragActive(false);
    setSelectedFile(null);
    setDescripcion("");
    setTipoAdjunto("");
    setComentario("");
    if (inputFileRef.current) {
      inputFileRef.current.value = "";
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetDraft();
    }

    onOpenChange(nextOpen);
  }

  function handleFileSelection(file: File | null) {
    dragDepthRef.current = 0;
    setIsDragActive(false);
    setSelectedFile(file);

    if (!file && inputFileRef.current) {
      inputFileRef.current.value = "";
    }
  }

  function openFileSelector() {
    if (isSaving) {
      return;
    }

    if (inputFileRef.current) {
      inputFileRef.current.value = "";
      inputFileRef.current.click();
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    handleFileSelection(event.target.files?.[0] ?? null);
  }

  function handleDropzoneClick() {
    openFileSelector();
  }

  function handleDropzoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isSaving) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFileSelector();
    }
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

    dragDepthRef.current += 1;
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

    if (isSaving || !hasDraggedFiles(event)) {
      return;
    }

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    dragDepthRef.current = 0;
    setIsDragActive(false);

    if (isSaving) {
      return;
    }

    const [file] = Array.from(event.dataTransfer.files);

    if (!file) {
      return;
    }

    handleFileSelection(file);
  }

  function handleReplaceFile(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    openFileSelector();
  }

  function handleRemoveFile(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (isSaving) {
      return;
    }

    handleFileSelection(null);
  }

  async function handleSave() {
    const metadata = {
      comentario: comentario.trim() || undefined,
      descripcion: descripcion.trim() || undefined,
      tipoAdjunto: tipoAdjunto.trim() || undefined,
    };

    if (onSaveEdit) {
      return onSaveEdit({ ...metadata, file: selectedFile });
    }

    if (!selectedFile || !onSave) {
      return false;
    }

    return onSave({ ...metadata, file: selectedFile });
  }

  const existingFileName = initialValues?.existingFileName;
  const showExistingFile = isEditMode && !selectedFile && existingFileName;

  return (
    <DialogRoot onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] max-w-[800px] flex-col overflow-hidden p-0">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-background text-foreground-secondary">
              <Paperclip className="size-4" />
            </span>
            <DialogTitle className="text-2xl font-semibold leading-none text-foreground">
              {isEditMode ? "Editar Adjunto" : "Adjunto Solicitud"}
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
          <ModalSection title="Adjunto Solicitud">
            <div className="grid gap-4 md:grid-cols-2">
              <input
                className="hidden"
                onChange={handleFileInputChange}
                ref={inputFileRef}
                type="file"
              />
              <div className="grid gap-1.5 md:col-span-2">
                <span className="text-xs font-medium text-foreground-secondary">
                  Archivo
                </span>
                <div className="space-y-2">
                  <div
                    aria-describedby={
                      selectedFile ? selectedFileNameId : fileInputHintId
                    }
                    aria-disabled={isSaving}
                    aria-label="Seleccionar archivo"
                    className={cn(
                      legacyFieldClassName,
                      "min-h-32 cursor-pointer flex-col items-center justify-center gap-2 border-dashed px-4 py-4 text-center",
                      isSaving
                        ? "cursor-not-allowed opacity-60"
                        : "hover:border-input-focus hover:bg-background",
                      isDragActive
                        ? "border-input-focus bg-background ring-2 ring-input-focus/20"
                        : "",
                    )}
                    onClick={handleDropzoneClick}
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
                    {selectedFile ? (
                      <div
                        className="space-y-1"
                        id={selectedFileNameId}
                        aria-live="polite"
                      >
                        <p className="text-sm font-medium text-foreground">
                          {selectedFile.name}
                        </p>
                        <p className="text-xs text-foreground-secondary">
                          Arrastrá otro archivo aquí o usá las acciones para
                          cambiarlo.
                        </p>
                      </div>
                    ) : showExistingFile ? (
                      <div className="space-y-1" id={fileInputHintId}>
                        <p className="text-sm font-medium text-foreground">
                          {existingFileName}
                        </p>
                        <p className="text-xs text-foreground-secondary">
                          Archivo actual — arrastrá uno nuevo aquí para
                          reemplazarlo.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          Seleccionar archivo
                        </p>
                        <p
                          className="text-xs text-foreground-secondary"
                          id={fileInputHintId}
                        >
                          Arrastrá un archivo aquí o hacé clic para
                          seleccionarlo
                        </p>
                      </div>
                    )}
                  </div>

                  {selectedFile ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        disabled={isSaving}
                        onClick={handleReplaceFile}
                        type="button"
                        variant="outline"
                      >
                        Reemplazar
                      </Button>
                      <Button
                        disabled={isSaving}
                        onClick={handleRemoveFile}
                        type="button"
                        variant="outline"
                      >
                        Quitar
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
              <ModalField label="Descripción">
                <Input
                  onChange={(event) => setDescripcion(event.target.value)}
                  value={descripcion}
                />
              </ModalField>
              <ModalField label="Tipo Adjunto">
                <div className="flex min-w-0 gap-1">
                  <Input
                    onChange={(event) => setTipoAdjunto(event.target.value)}
                    value={tipoAdjunto}
                  />
                  <LegacyIconButton className="text-foreground-secondary">
                    <Plus className="size-4" />
                  </LegacyIconButton>
                  <LegacyIconButton className="text-foreground-secondary">
                    <ChevronDown className="size-4" />
                  </LegacyIconButton>
                </div>
              </ModalField>
              <ModalField label="Modificado">
                <Input disabled value="" />
              </ModalField>
            </div>
          </ModalSection>

          <ModalField label="Comentario">
            <textarea
              className={`${legacyFieldClassName} h-20 resize-none py-2`}
              onChange={(event) => setComentario(event.target.value)}
              value={comentario}
            />
          </ModalField>
        </div>

        <footer className="shrink-0 border-t border-border bg-surface px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <Button
              disabled={(!isEditMode && !selectedFile) || isSaving}
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
