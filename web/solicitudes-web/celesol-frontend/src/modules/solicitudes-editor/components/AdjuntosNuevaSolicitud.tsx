import { Eye, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type {
  PendingSolicitudCoreAdjunto,
  SolicitudCoreAdjuntoResponse,
  UploadSolicitudCoreAdjuntoRequest,
} from "@/modules/solicitudes/types/solicitudes-core";
import { Button } from "@/shared/components/ui/button";

import { AdjuntoPreviewModal } from "./AdjuntoPreviewModal";
import { AdjuntosLoteModal, type AdjuntoLoteItem } from "./AdjuntosLoteModal";
import { NuevaAdjuntoModal } from "./NuevaAdjuntoModal";

// Adjuntos de Nueva solicitud en una lista corta: los archivos quedan
// pendientes y se suben al guardar. Reemplaza a la tabla con buscador.
export function AdjuntosNuevaSolicitud({
  adjuntos,
  isUploading,
  onDeletePendingAdjunto,
  onEditPendingAdjunto,
  onNewAdjuntosLote,
  pendingAdjuntos,
}: {
  adjuntos: SolicitudCoreAdjuntoResponse[];
  isUploading: boolean;
  onDeletePendingAdjunto?: (localId: string) => void;
  onEditPendingAdjunto?: (
    localId: string,
    payload: UploadSolicitudCoreAdjuntoRequest,
  ) => void;
  onNewAdjuntosLote: (items: AdjuntoLoteItem[]) => Promise<boolean>;
  pendingAdjuntos: PendingSolicitudCoreAdjunto[];
}) {
  const [isAdjuntoModalOpen, setIsAdjuntoModalOpen] = useState(false);
  const [previewingAdjunto, setPreviewingAdjunto] =
    useState<PendingSolicitudCoreAdjunto | null>(null);
  const [editingAdjunto, setEditingAdjunto] =
    useState<PendingSolicitudCoreAdjunto | null>(null);
  const isEmpty = pendingAdjuntos.length === 0 && adjuntos.length === 0;
  const iconButtonClassName =
    "inline-flex size-8 items-center justify-center rounded-full text-foreground-secondary transition hover:bg-background hover:text-foreground";

  return (
    <>
      <section className="rounded-lg border border-border bg-surface p-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Adjuntos
              </h2>
              <p className="text-sm text-foreground-secondary">
                {isEmpty
                  ? "Para enviar a Riesgo se requiere el recibo de sueldo."
                  : "Se adjuntan al guardar la solicitud."}
              </p>
            </div>
          </div>
          <Button
            className="rounded-md"
            onClick={() => setIsAdjuntoModalOpen(true)}
            type="button"
            variant="outline"
          >
            <Plus className="size-4" />
            Adjuntar archivos
          </Button>
        </header>

        {!isEmpty ? (
          <ul className="mt-3 divide-y divide-border-soft rounded-md border border-border-soft">
            {pendingAdjuntos.map((adjunto) => (
              <li
                className="flex items-center gap-3 px-3 py-2 text-sm"
                key={adjunto.localId}
              >
                <Paperclip className="size-4 shrink-0 text-foreground-muted" />
                <span
                  className="min-w-0 flex-1 truncate"
                  title={adjunto.file.name}
                >
                  {adjunto.file.name}
                </span>
                {adjunto.tipoAdjunto ? (
                  <span className="hidden shrink-0 rounded-full bg-background px-2.5 py-0.5 text-xs text-foreground-secondary sm:inline">
                    {adjunto.tipoAdjunto}
                  </span>
                ) : null}
                <div className="flex shrink-0 items-center">
                  <button
                    aria-label={`Ver ${adjunto.file.name}`}
                    className={iconButtonClassName}
                    onClick={() => setPreviewingAdjunto(adjunto)}
                    title="Vista previa"
                    type="button"
                  >
                    <Eye className="size-4" />
                  </button>
                  {onEditPendingAdjunto ? (
                    <button
                      aria-label={`Editar ${adjunto.file.name}`}
                      className={iconButtonClassName}
                      onClick={() => setEditingAdjunto(adjunto)}
                      title="Editar"
                      type="button"
                    >
                      <Pencil className="size-4" />
                    </button>
                  ) : null}
                  {onDeletePendingAdjunto ? (
                    <button
                      aria-label={`Quitar ${adjunto.file.name}`}
                      className={iconButtonClassName}
                      onClick={() => onDeletePendingAdjunto(adjunto.localId)}
                      title="Quitar"
                      type="button"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
            {adjuntos.map((adjunto) => (
              <li
                className="flex items-center gap-3 px-3 py-2 text-sm"
                key={adjunto.id}
              >
                <Paperclip className="size-4 shrink-0 text-foreground-muted" />
                <span className="min-w-0 flex-1 truncate">
                  {adjunto.archivoNombre ?? ""}
                </span>
                {adjunto.tipoAdjunto ? (
                  <span className="hidden shrink-0 rounded-full bg-background px-2.5 py-0.5 text-xs text-foreground-secondary sm:inline">
                    {adjunto.tipoAdjunto}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <AdjuntosLoteModal
        isSaving={isUploading}
        onOpenChange={setIsAdjuntoModalOpen}
        onSave={async (items) => {
          const saved = await onNewAdjuntosLote(items);
          if (saved) {
            setIsAdjuntoModalOpen(false);
          }
          return saved;
        }}
        open={isAdjuntoModalOpen}
      />
      <AdjuntoPreviewModal
        file={previewingAdjunto?.file ?? null}
        onOpenChange={(open) => {
          if (!open) setPreviewingAdjunto(null);
        }}
        open={previewingAdjunto !== null}
      />
      <NuevaAdjuntoModal
        initialValues={editingAdjunto ?? undefined}
        onOpenChange={(open) => {
          if (!open) setEditingAdjunto(null);
        }}
        onSave={async (payload) => {
          if (!editingAdjunto || !onEditPendingAdjunto) return false;
          onEditPendingAdjunto(editingAdjunto.localId, payload);
          setEditingAdjunto(null);
          return true;
        }}
        open={editingAdjunto !== null}
      />
    </>
  );
}
