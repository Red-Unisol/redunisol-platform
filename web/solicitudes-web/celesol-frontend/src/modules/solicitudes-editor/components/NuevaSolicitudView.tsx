import { ArrowLeft, CircleAlert, FileText } from "lucide-react";
import { useState } from "react";
import { Controller } from "react-hook-form";

import type { CreateSolicitudCoreGarantiaRequest } from "@/modules/solicitudes/types/solicitudes-core";
import type {
  PendingSolicitudCoreAdjunto,
  SolicitudCoreAdjuntoResponse,
  UploadSolicitudCoreAdjuntoRequest,
} from "@/modules/solicitudes/types/solicitudes-core";
import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";
import { MoneyInputField } from "@/shared/components/forms/money-input-field";
import { Button } from "@/shared/components/ui/button";
import { NUEVA_SOLICITUD_TABS } from "../constants/solicitud-tabs";
import type {
  NuevaSolicitudFormValues,
  NuevaSolicitudTab,
  SolicitudFormControl,
  SolicitudFormRegister,
  StyledSelectOption,
} from "../types";
import {
  getCupoTitularPlaceholder,
  getCuotasPlaceholder,
  getMontoAFinanciarPlaceholder,
} from "../utils/linea-placeholders";
import { NuevaSolicitudAdjuntosSection } from "./AdjuntosSection";
import type { AdjuntoLoteItem } from "./AdjuntosLoteModal";
import { GarantiasSection } from "./GarantiasSection";
import { NuevaGarantiaModal } from "./NuevaGarantiaModal";
import { NuevaSolicitudTitularFields } from "./NuevaSolicitudTitularSection";
import { NuevaSolicitudToolbar } from "./SolicitudToolbar";
import {
  LegacyField,
  Section,
  SectionTabs,
  StyledSelect,
  legacyFieldClassName,
} from "./fields/base";

const VALIDATION_FIELDS: Array<{
  key: keyof NuevaSolicitudFormValues;
  label: string;
}> = [
  { key: "linea", label: "Línea de préstamo" },
  { key: "montoAFinanciar", label: "Monto a financiar" },
  { key: "cuotas", label: "Cuotas" },
  { key: "documento", label: "Tipo de documento" },
  { key: "noDocumento", label: "Nro. de documento" },
  { key: "cuit", label: "CUIT" },
  { key: "apellidoDenominacion", label: "Apellido / Denominación" },
  { key: "nombre", label: "Nombre" },
  { key: "fechaNacimiento", label: "Fecha de nacimiento" },
];

type NuevaSolicitudViewProps = {
  adjuntos: SolicitudCoreAdjuntoResponse[];
  control: SolicitudFormControl;
  garantias: CreateSolicitudCoreGarantiaRequest[];
  isLoadingLineas: boolean;
  isSaving: boolean;
  isUploadingAdjunto: boolean;
  lineas: LineaPrestamoPresolicitud[];
  onAddGarantia: (garantia: CreateSolicitudCoreGarantiaRequest) => void;
  errors?: Partial<
    Record<keyof NuevaSolicitudFormValues, { message?: string }>
  >;
  onAddAdjuntosLote: (items: AdjuntoLoteItem[]) => Promise<boolean>;
  onEditAdjunto?: (
    localId: string,
    payload: UploadSolicitudCoreAdjuntoRequest,
  ) => void;
  onDeleteAdjunto?: (localId: string) => void;
  onBack: () => void;
  onLookupTitularByDocumento: () => void;
  onOpenSimulador: () => void;
  pendingAdjuntos: PendingSolicitudCoreAdjunto[];
  onSave: () => void;
  onTabChange: (tab: NuevaSolicitudTab) => void;
  register: SolicitudFormRegister;
  selectedLinea: LineaPrestamoPresolicitud | undefined;
  selectedWorkflowTransitionId: string;
  tab: NuevaSolicitudTab;
  workflowTransitionOptions: StyledSelectOption[];
  workflowTransitionPlaceholder: string;
  onWorkflowTransitionChange: (value: string) => void;
  isWorkflowTransitionDisabled: boolean;
};

export function NuevaSolicitudView({
  adjuntos,
  control,
  errors,
  garantias,
  isLoadingLineas,
  isSaving,
  isUploadingAdjunto,
  lineas,
  onAddGarantia,
  onAddAdjuntosLote,
  onEditAdjunto,
  onDeleteAdjunto,
  onBack,
  onLookupTitularByDocumento,
  onOpenSimulador,
  pendingAdjuntos,
  onSave,
  onTabChange,
  register,
  selectedLinea,
  selectedWorkflowTransitionId,
  tab,
  workflowTransitionOptions,
  workflowTransitionPlaceholder,
  onWorkflowTransitionChange,
  isWorkflowTransitionDisabled,
}: NuevaSolicitudViewProps) {
  const [isGarantiaModalOpen, setIsGarantiaModalOpen] = useState(false);

  return (
    <>
      <article className="flex flex-col rounded-md border border-border bg-surface shadow-sm">
        <header className="border-b border-border bg-surface px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              className="text-foreground-secondary"
              onClick={onBack}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <FileText className="size-4 text-primary" />
            <h1 className="text-[2rem] leading-none font-semibold text-foreground">
              Solicitud
            </h1>
          </div>
        </header>

        <NuevaSolicitudToolbar
          isSaving={isSaving}
          onOpenSimulador={onOpenSimulador}
          onSave={onSave}
          transitionControl={
            <StyledSelect
              className="!h-7 !min-h-7 rounded-[min(var(--radius-md),12px)] !px-2.5 !py-0 text-[0.8rem] leading-none"
              disabled={isWorkflowTransitionDisabled}
              onChange={onWorkflowTransitionChange}
              options={workflowTransitionOptions}
              placeholder={workflowTransitionPlaceholder}
              value={selectedWorkflowTransitionId}
            />
          }
        />

        {errors &&
          (() => {
            const errorItems = VALIDATION_FIELDS.filter(
              ({ key }) => !!errors[key],
            );
            return errorItems.length > 0 ? (
              <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">
                    Completá los siguientes campos antes de guardar:
                  </p>
                  <ul className="mt-1 list-inside list-disc">
                    {errorItems.map(({ key, label }) => (
                      <li key={key}>{label}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null;
          })()}

        <div className="p-3 md:p-4">
          <form className="space-y-7">
            <Section title="Solicitud">
              <div className="space-y-3">
                <LegacyField label="Línea" required>
                  <Controller
                    control={control}
                    name="linea"
                    render={({ field }) => (
                      <StyledSelect
                        disabled={isLoadingLineas}
                        invalid={!!errors?.linea}
                        onChange={field.onChange}
                        options={lineas.flatMap((linea) => {
                          const descripcion = linea.descripcion ?? "";

                          return descripcion
                            ? [{ label: descripcion, value: descripcion }]
                            : [];
                        })}
                        placeholder={
                          isLoadingLineas
                            ? "Cargando líneas..."
                            : "Seleccione una línea"
                        }
                        searchable
                        value={field.value}
                      />
                    )}
                  />
                </LegacyField>
                <LegacyField label="Monto A Financiar" required>
                  <MoneyInputField
                    control={control}
                    invalid={!!errors?.montoAFinanciar}
                    name="montoAFinanciar"
                    placeholder={getMontoAFinanciarPlaceholder(selectedLinea)}
                  />
                </LegacyField>
                <LegacyField label="Cuotas" required>
                  <input
                    aria-invalid={!!errors?.cuotas}
                    className={legacyFieldClassName}
                    placeholder={getCuotasPlaceholder(selectedLinea)}
                    {...register("cuotas")}
                  />
                </LegacyField>
                <LegacyField label="Cupo Titular">
                  <MoneyInputField
                    control={control}
                    name="cupoTitular"
                    placeholder={getCupoTitularPlaceholder(selectedLinea)}
                  />
                </LegacyField>
              </div>
            </Section>

            <section>
              <SectionTabs<NuevaSolicitudTab>
                activeTab={tab}
                onTabChange={onTabChange}
                tabs={NUEVA_SOLICITUD_TABS}
              />
              {tab === "titular" ? (
                <NuevaSolicitudTitularFields
                  control={control}
                  errors={errors}
                  onLookupByDocumento={onLookupTitularByDocumento}
                  register={register}
                />
              ) : (
                <GarantiasSection
                  garantias={garantias}
                  onNew={() => setIsGarantiaModalOpen(true)}
                />
              )}
            </section>

            <NuevaSolicitudAdjuntosSection
              adjuntos={adjuntos}
              isUploading={isUploadingAdjunto}
              onNewAdjuntosLote={onAddAdjuntosLote}
              onEditPendingAdjunto={onEditAdjunto}
              onDeletePendingAdjunto={onDeleteAdjunto}
              pendingAdjuntos={pendingAdjuntos}
            />
          </form>
        </div>
      </article>
      <NuevaGarantiaModal
        onOpenChange={setIsGarantiaModalOpen}
        onSave={onAddGarantia}
        open={isGarantiaModalOpen}
      />
    </>
  );
}
