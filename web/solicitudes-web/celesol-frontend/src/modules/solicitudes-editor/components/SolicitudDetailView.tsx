import { ArrowLeft, FileText } from "lucide-react";

import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";
import type { SolicitudCoreGarantiaResponse } from "@/modules/solicitudes/types/solicitudes-core";
import { getEstadoBadgeVariant } from "@/modules/solicitudes-shared/utils/estado-badge-variant";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

import type {
  DatosPersonalesTab,
  LegacyOption,
  SolicitanteTab,
  SolicitudFormControl,
  SolicitudFormErrors,
  SolicitudFormRegister,
  TabItem,
} from "../types";
import { SolicitudAdjuntosSection } from "./AdjuntosSection";
import { SolicitudDatosPersonalesSection } from "./DatosPersonalesSection";
import { SolicitudMainSection } from "./SolicitudMainSection";
import { SolicitudDetailToolbar } from "./SolicitudToolbar";
import { Section, SectionTabs } from "./fields/base";

type SolicitanteContentTab = DatosPersonalesTab | "adjuntos";

const SOLICITANTE_CONTENT_TABS: TabItem<SolicitanteContentTab>[] = [
  { label: "Datos Personales", value: "datosPersonales" },
  { label: "Cónyuge", value: "conyuge" },
  { label: "Económicos/Laborales", value: "economicosLaborales" },
  { label: "Adicionales", value: "adicionales" },
  { label: "Adjuntos", value: "adjuntos" },
];

export type SolicitudDetailViewProps = {
  control: SolicitudFormControl;
  currentEstado: string;
  datosPersonalesTab: DatosPersonalesTab;
  detailTitle: string;
  estadoCivilOptions: LegacyOption[];
  errors: SolicitudFormErrors;
  isLoadingLegacyData: boolean;
  isLoadingLineas: boolean;
  isEditing?: boolean;
  legacyNotice: string | null;
  lineas: LineaPrestamoPresolicitud[];
  onBack: () => void;
  onDatosPersonalesTabChange: (tab: DatosPersonalesTab) => void;
  onGarantiaEdit?: (index: number) => void;
  onOpenSimulador: () => void;
  onPreloadSimulador: () => void;
  onSolicitanteTabChange: (tab: SolicitanteTab) => void;
  register: SolicitudFormRegister;
  selectedLinea: LineaPrestamoPresolicitud | undefined;
  garantias?: SolicitudCoreGarantiaResponse[];
  sexoConyugeOptions: LegacyOption[];
  sexoOptions: LegacyOption[];
  solicitanteTab: SolicitanteTab;
};

export function SolicitudDetailView({
  control,
  currentEstado,
  datosPersonalesTab,
  detailTitle,
  estadoCivilOptions,
  errors,
  isLoadingLegacyData,
  isLoadingLineas,
  isEditing = false,
  legacyNotice,
  garantias = [],
  lineas,
  onBack,
  onDatosPersonalesTabChange,
  onGarantiaEdit,
  onOpenSimulador,
  onPreloadSimulador,
  onSolicitanteTabChange,
  register,
  selectedLinea,
  sexoConyugeOptions,
  sexoOptions,
  solicitanteTab,
}: SolicitudDetailViewProps) {
  const activeContentTab =
    solicitanteTab === "adjuntos" ? "adjuntos" : datosPersonalesTab;

  return (
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
            {detailTitle}
          </h1>
          <Badge
            className="ml-auto shrink-0 px-4 py-1.5 text-sm font-semibold"
            dot
            variant={getEstadoBadgeVariant(currentEstado)}
          >
            {currentEstado}
          </Badge>
        </div>
      </header>

      <SolicitudDetailToolbar
        onOpenSimulador={onOpenSimulador}
        onPreloadSimulador={onPreloadSimulador}
      />

      <div className="p-3 md:p-4">
        {isLoadingLegacyData ? (
          <p className="mb-3 text-sm text-foreground-secondary">
            Cargando datos de la solicitud...
          </p>
        ) : null}
        {legacyNotice ? (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {legacyNotice}
          </p>
        ) : null}
        <form className="space-y-3 md:space-y-4">
          <SolicitudMainSection
            control={control}
            errors={errors}
            isLoadingLineas={isLoadingLineas}
            lineas={lineas}
            register={register}
            selectedLinea={selectedLinea}
          />
          <Section title="Solicitante">
            <SectionTabs<SolicitanteContentTab>
              activeTab={activeContentTab}
              onTabChange={(tab) => {
                if (tab === "adjuntos") {
                  onSolicitanteTabChange("adjuntos");
                  return;
                }

                onSolicitanteTabChange("solicitante");
                onDatosPersonalesTabChange(tab);
              }}
              tabs={SOLICITANTE_CONTENT_TABS}
            />
            {activeContentTab === "adjuntos" ? (
              <SolicitudAdjuntosSection />
            ) : (
              <SolicitudDatosPersonalesSection
                activeTab={datosPersonalesTab}
                control={control}
                embedded
                estadoCivilOptions={estadoCivilOptions}
                garantias={garantias}
                isEditing={isEditing}
                onGarantiaEdit={onGarantiaEdit}
                onTabChange={onDatosPersonalesTabChange}
                register={register}
                sexoConyugeOptions={sexoConyugeOptions}
                sexoOptions={sexoOptions}
                showTabs={false}
              />
            )}
          </Section>
        </form>
      </div>
    </article>
  );
}
