import {
  ChevronDown,
  Eye,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import type {
  PendingSolicitudCoreAdjunto,
  SolicitudCoreAdjuntoResponse,
  UploadSolicitudCoreAdjuntoRequest,
} from "@/modules/solicitudes/types/solicitudes-core";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

import { AdjuntoPreviewModal } from "./AdjuntoPreviewModal";
import { AdjuntosLoteModal, type AdjuntoLoteItem } from "./AdjuntosLoteModal";
import { NuevaAdjuntoModal } from "./NuevaAdjuntoModal";
import { LegacyIconButton, Section, legacyFieldClassName } from "./fields/base";

export function NuevaSolicitudAdjuntosSection({
  adjuntos,
  pendingAdjuntos,
  isUploading,
  onNewAdjuntosLote,
  onEditPendingAdjunto,
  onDeletePendingAdjunto,
}: {
  adjuntos: SolicitudCoreAdjuntoResponse[];
  pendingAdjuntos: PendingSolicitudCoreAdjunto[];
  isUploading: boolean;
  onNewAdjuntosLote: (items: AdjuntoLoteItem[]) => Promise<boolean>;
  onEditPendingAdjunto?: (
    localId: string,
    payload: UploadSolicitudCoreAdjuntoRequest,
  ) => void;
  onDeletePendingAdjunto?: (localId: string) => void;
}) {
  const [isAdjuntoModalOpen, setIsAdjuntoModalOpen] = useState(false);
  const [previewingAdjunto, setPreviewingAdjunto] =
    useState<PendingSolicitudCoreAdjunto | null>(null);
  const [editingAdjunto, setEditingAdjunto] =
    useState<PendingSolicitudCoreAdjunto | null>(null);
  const columns = ["", "Tipo Adjunto", "Descripción", "Archivo", "Acciones"];

  return (
    <>
      <Section title="Adjuntos">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="h-9 px-3 text-foreground-secondary"
              onClick={() => setIsAdjuntoModalOpen(true)}
              type="button"
              variant="outline"
            >
              <Plus className="size-4 text-primary" />
              Nuevo
            </Button>
            <LegacyIconButton className="size-9" disabled>
              <Trash2 className="size-4" />
            </LegacyIconButton>
            <div className="flex h-9 w-64 items-center gap-1">
              <input
                className={legacyFieldClassName}
                placeholder="Texto a buscar"
                type="text"
              />
              <LegacyIconButton className="size-9 text-primary">
                <Search className="size-4" />
              </LegacyIconButton>
            </div>
            <LegacyIconButton className="size-9">
              <FileText className="size-4" />
            </LegacyIconButton>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="bg-background text-left text-xs text-foreground-secondary">
                <tr>
                  {columns.map((column, index) => (
                    <th
                      className="h-12 border-r border-border px-3 py-2 font-medium last:border-r-0"
                      key={`${column}-${index}`}
                    >
                      {index === 0 ? (
                        <input type="checkbox" />
                      ) : column === "Acciones" ? (
                        column
                      ) : (
                        <span className="inline-flex w-full items-center justify-between gap-1">
                          {column}
                          <Search className="size-3.5 text-foreground-secondary" />
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingAdjuntos.length > 0 || adjuntos.length > 0 ? (
                  <>
                    {pendingAdjuntos.map((adjunto) => (
                      <tr key={adjunto.localId}>
                        <td className="border-t border-r border-border px-3 py-2">
                          <input type="checkbox" />
                        </td>
                        <td className="border-t border-r border-border px-3 py-2">
                          {adjunto.tipoAdjunto ?? ""}
                        </td>
                        <td className="border-t border-r border-border px-3 py-2">
                          {adjunto.descripcion ?? ""}
                        </td>
                        <td className="border-t border-r border-border px-3 py-2">
                          {adjunto.file.name} (pendiente)
                        </td>
                        <td className="border-t border-border px-3 py-2">
                          <div className="flex items-center gap-1">
                            <LegacyIconButton
                              className="size-7 text-foreground-secondary"
                              onClick={() => setPreviewingAdjunto(adjunto)}
                              title="Vista previa"
                              type="button"
                            >
                              <Eye className="size-3.5" />
                            </LegacyIconButton>
                            {onEditPendingAdjunto ? (
                              <LegacyIconButton
                                className="size-7 text-foreground-secondary"
                                onClick={() => setEditingAdjunto(adjunto)}
                                title="Editar"
                                type="button"
                              >
                                <Pencil className="size-3.5" />
                              </LegacyIconButton>
                            ) : null}
                            {onDeletePendingAdjunto ? (
                              <LegacyIconButton
                                className="size-7 text-foreground-secondary"
                                onClick={() =>
                                  onDeletePendingAdjunto(adjunto.localId)
                                }
                                title="Eliminar"
                                type="button"
                              >
                                <Trash2 className="size-3.5" />
                              </LegacyIconButton>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {adjuntos.map((adjunto) => (
                      <tr key={adjunto.id}>
                        <td className="border-t border-r border-border px-3 py-2">
                          <input type="checkbox" />
                        </td>
                        <td className="border-t border-r border-border px-3 py-2">
                          {adjunto.tipoAdjunto ?? ""}
                        </td>
                        <td className="border-t border-r border-border px-3 py-2">
                          {adjunto.descripcion ?? ""}
                        </td>
                        <td className="border-t border-r border-border px-3 py-2">
                          {adjunto.archivoNombre ?? ""}
                        </td>
                        <td className="border-t border-border px-3 py-2" />
                      </tr>
                    ))}
                  </>
                ) : (
                  <tr>
                    <td
                      className="h-24 text-center text-xs font-semibold text-foreground-muted"
                      colSpan={columns.length}
                    >
                      Sin datos para mostrar
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {pendingAdjuntos.length > 0 ? (
            <p className="text-xs text-foreground-muted">
              Los adjuntos pendientes se cargarán automáticamente al guardar la
              solicitud.
            </p>
          ) : null}

          <div className="flex items-center justify-between">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
              1
            </span>
            <div className="flex items-center gap-2 text-xs text-foreground-secondary">
              <span>Tamaño de página:</span>
              <Button size="sm" type="button" variant="outline">
                20
                <ChevronDown className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </Section>
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
        open={previewingAdjunto !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewingAdjunto(null);
        }}
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

export function SolicitudAdjuntosSection() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-9 px-3 text-sm" type="button">
          <Plus className="size-4" />
          Nuevo
        </Button>
        <div className="relative w-full min-w-52 max-w-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
          <Input className="pl-9" placeholder="Texto a buscar" />
        </div>
      </div>
      <div className="mt-3 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="bg-background text-xs text-foreground-secondary">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Archivo</th>
              <th className="px-3 py-2 text-left font-medium">Tipo</th>
              <th className="px-3 py-2 text-left font-medium">Descripción</th>
              <th className="px-3 py-2 text-left font-medium">Estado</th>
              <th className="px-3 py-2 text-left font-medium">Verif</th>
              <th className="px-3 py-2 text-left font-medium">Tamaño</th>
              <th className="px-3 py-2 text-left font-medium">Subido por</th>
              <th className="px-3 py-2 text-left font-medium">Fecha</th>
              <th className="px-3 py-2 text-left font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td
                className="px-3 py-4 text-center text-xs text-foreground-muted"
                colSpan={9}
              >
                Sin datos para mostrar
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
