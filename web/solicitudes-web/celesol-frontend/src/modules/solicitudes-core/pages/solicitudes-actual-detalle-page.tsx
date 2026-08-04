import {
  ArrowLeft,
  CircleAlert,
  CircleCheckBig,
  Clock,
  Download,
  Eye,
  FileText,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import { authQueryKeys } from "@/modules/auth/hooks/use-auth-session";
import {
  canAccessRiesgoTools,
  canCreateSocio,
} from "@/modules/auth/utils/auth-user";
import { AdjuntoPreviewModal } from "@/modules/solicitudes-editor/components/AdjuntoPreviewModal";
import {
  AdjuntosLoteModal,
  type AdjuntoLoteItem,
} from "@/modules/solicitudes-editor/components/AdjuntosLoteModal";
import { NuevaAdjuntoModal } from "@/modules/solicitudes-editor/components/NuevaAdjuntoModal";
import {
  NuevaCancelacionModal,
  type NuevaCancelacionValues,
} from "@/modules/solicitudes-editor/components/NuevaCancelacionModal";
import { NuevaGarantiaModal } from "@/modules/solicitudes-editor/components/NuevaGarantiaModal";
import { SolicitudDetailToolbar } from "@/modules/solicitudes-editor/components/SolicitudToolbar";
import { SolicitudWorkflowActionDialog } from "@/modules/solicitudes-core/components/solicitud-workflow-action-dialog";
import { SolicitudWorkflowHistorySection } from "@/modules/solicitudes-core/components/solicitud-workflow-history-section";
import {
  RequiredMark,
  Section,
  SectionTabs,
  StyledSelect,
  legacyFieldClassName,
} from "@/modules/solicitudes-editor/components/fields/base";
import {
  ESTADO_CIVIL_OPTIONS,
  SEXO_OPTIONS,
  TIPO_DOCUMENTO_OPTIONS,
} from "@/modules/solicitudes-editor/constants/legacy-options";
import type {
  DatosPersonalesTab,
  StyledSelectOption,
  TabItem,
} from "@/modules/solicitudes-editor/types";
import { useDeleteSolicitudCoreAdjuntoMutation } from "@/modules/solicitudes-core/hooks/use-delete-solicitud-core-adjunto-mutation";
import { useDownloadSolicitudCoreAdjuntoMutation } from "@/modules/solicitudes-core/hooks/use-download-solicitud-core-adjunto-mutation";
import { usePatchSolicitudCoreAdjuntoMutation } from "@/modules/solicitudes-core/hooks/use-patch-solicitud-core-adjunto-mutation";
import { useExecuteSolicitudCoreTransitionMutation } from "@/modules/solicitudes-core/hooks/use-execute-solicitud-core-transition-mutation";
import { usePatchSolicitudCoreMutation } from "@/modules/solicitudes-core/hooks/use-patch-solicitud-core-mutation";
import { useAssignSolicitudToSelfMutation } from "@/modules/solicitudes-core/hooks/use-assign-solicitud-to-self-mutation";
import { useAssignSolicitudToUserMutation } from "@/modules/solicitudes-core/hooks/use-assign-solicitud-to-user-mutation";
import { useSolicitudCoreAdjuntosQuery } from "@/modules/solicitudes-core/hooks/use-solicitud-core-adjuntos-query";
import { useSolicitudCoreCancelacionesQuery } from "@/modules/solicitudes-core/hooks/use-solicitud-core-cancelaciones-query";
import { useCreateSolicitudCoreCancelacionMutation } from "@/modules/solicitudes-core/hooks/use-create-solicitud-core-cancelacion-mutation";
import { useUpdateSolicitudCoreCancelacionMutation } from "@/modules/solicitudes-core/hooks/use-update-solicitud-core-cancelacion-mutation";
import { useDeleteSolicitudCoreCancelacionMutation } from "@/modules/solicitudes-core/hooks/use-delete-solicitud-core-cancelacion-mutation";
import { useSolicitudAssignableAgentsQuery } from "@/modules/solicitudes-core/hooks/use-solicitud-assignable-agents-query";
import { useSolicitudCoreDetailQuery } from "@/modules/solicitudes-core/hooks/use-solicitud-core-detail-query";
import { useSolicitudCoreHistoryQuery } from "@/modules/solicitudes-core/hooks/use-solicitud-core-history-query";
import { useLineasPrestamoQuery } from "@/modules/solicitudes-core/hooks/use-lineas-prestamo-query";
import { useSociosCancelacionesQuery } from "@/modules/solicitudes-core/hooks/use-socios-cancelaciones-query";
import { useSolicitudCoreTransitionsQuery } from "@/modules/solicitudes-core/hooks/use-solicitud-core-transitions-query";
import {
  uploadSolicitudCoreAdjunto,
  uploadSolicitudCoreAdjuntosLote,
} from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";
import { SolicitudesContentLoader } from "@/modules/solicitudes-shared/components/solicitudes-content-loader";
import { getEstadoBadgeVariant } from "@/modules/solicitudes-shared/utils/estado-badge-variant";
import { loadSimuladorPrestamoModal } from "@/modules/solicitudes-shared/utils/load-simulador-prestamo-modal";
import { prefetchWhenIdle } from "@/modules/solicitudes-shared/utils/prefetch-when-idle";
import type {
  CreateSolicitudCoreGarantiaRequest,
  SolicitudCoreAppearance,
  SolicitudCoreAdjuntoResponse,
  SolicitudCoreCancelacionResponse,
  SolicitudCoreConyugeResponse,
  SolicitudCoreDatosLaboralesResponse,
  SolicitudCoreGarantiaResponse,
  SolicitudCoreResponse,
  SolicitudCoreTitularResponse,
  UploadSolicitudCoreAdjuntoRequest,
  ExecuteWorkflowTransitionRequest,
  WorkflowTransition,
} from "@/modules/solicitudes/types/solicitudes-core";
import {
  mapEditableValuesToPatchSolicitudCoreRequest,
  mapSolicitudCoreToEditableValues,
  type EditableSolicitudCoreValues,
} from "@/modules/solicitudes-core/utils/solicitud-core-edit-mappers";
import {
  areAllGarantiasFieldsEditable,
  GARANTIAS_FIELD_KEYS,
  hasAnyGarantiasFieldEditable,
  hasAnySolicitudFieldEditable,
  isFieldEditable,
} from "@/modules/solicitudes-core/utils/solicitud-field-access";
import { canManageSolicitudAssignment } from "@/modules/solicitudes-core/utils/solicitud-assignment";
import { calculateAge } from "@/modules/solicitudes-editor/utils/calculate-age";
import { buildSocioPrefillFromTitular } from "@/modules/solicitudes-core/utils/build-socio-prefill-from-titular";
import { getSolicitudCoreDetailOriginPath } from "@/modules/solicitudes/utils/solicitud-detail-navigation";
import { SocioFormDialog } from "@/modules/socios/components/socio-form-dialog";
import { createSocio } from "@/modules/socios/services/socios-api";
import { useCreatePrestamoLegacyMutation } from "@/modules/solicitudes-core/hooks/use-create-prestamo-legacy-mutation";
import type {
  CreateSocioRequest,
  UpdateSocioRequest,
} from "@/modules/socios/types";
import { StaticMoneyInput } from "@/shared/components/forms/money-input-field";
import {
  formatMoneyValue,
  formatNullableAmount,
  parseMoneyValue,
} from "@/shared/utils/money-format";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { IdChip } from "@/shared/components/ui/id-chip";
import { DateInput } from "@/shared/components/ui/date-input";
import {
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { StaticInternationalPhoneField } from "@/shared/components/ui/international-phone-field";
import { ModalLoadingOverlay } from "@/shared/components/ui/modal-loading-overlay";
import { TableEmptyState } from "@/shared/components/ui/table-empty-state";
import { ApiError } from "@/shared/services/http/api-error";

const EDIT_SOLICITUD_ERROR_TOAST_ID = "edit-solicitud-core-error";
const EDIT_SOLICITUD_SUCCESS_TOAST_ID = "edit-solicitud-core-success";
const DELETE_ADJUNTO_ERROR_TOAST_ID = "delete-solicitud-core-adjunto-error";
const DELETE_ADJUNTO_SUCCESS_TOAST_ID = "delete-solicitud-core-adjunto-success";
const DOWNLOAD_ADJUNTO_ERROR_TOAST_ID = "download-solicitud-core-adjunto-error";
const PREVIEW_ADJUNTO_ERROR_TOAST_ID = "preview-solicitud-core-adjunto-error";
const REPLACE_ADJUNTO_SUCCESS_TOAST_ID =
  "replace-solicitud-core-adjunto-success";
const REPLACE_ADJUNTO_ERROR_TOAST_ID = "replace-solicitud-core-adjunto-error";
const UPLOAD_ADJUNTO_ERROR_TOAST_ID = "upload-solicitud-core-adjunto-error";
const UPLOAD_ADJUNTO_SUCCESS_TOAST_ID = "upload-solicitud-core-adjunto-success";
const WORKFLOW_TRANSITION_ERROR_TOAST_ID =
  "execute-solicitud-core-transition-error";
const WORKFLOW_TRANSITION_SUCCESS_TOAST_ID =
  "execute-solicitud-core-transition-success";
const ASSIGN_TO_USER_ERROR_TOAST_ID = "assign-solicitud-core-user-error";
const ASSIGN_TO_USER_SUCCESS_TOAST_ID = "assign-solicitud-core-user-success";
const CREATE_SOCIO_SUCCESS_TOAST_ID = "create-socio-from-solicitud-success";
const CREATE_PRESTAMO_LEGACY_ERROR_TOAST_ID = "create-prestamo-legacy-error";
const CREATE_PRESTAMO_LEGACY_SUCCESS_TOAST_ID =
  "create-prestamo-legacy-success";
const CREATE_CANCELACION_ERROR_TOAST_ID =
  "create-solicitud-core-cancelacion-error";
const UPDATE_CANCELACION_ERROR_TOAST_ID =
  "update-solicitud-core-cancelacion-error";
const DELETE_CANCELACION_ERROR_TOAST_ID =
  "delete-solicitud-core-cancelacion-error";
const PLACEHOLDER = "-";
const DOWNLOAD_BUTTON_MIN_LOADING_MS = 450;
const FIRST_SUBMISSION_TRANSITION_LABEL = "Motor -> Riesgo";
const CONFIRMAR_ACTION_CODE = "confirmar";

type TitularConfirmarRequiredFieldKey =
  | "apellidoDenominacion"
  | "celular"
  | "cuit"
  | "email"
  | "fechaNacimiento"
  | "nombre"
  | "nroDocumento"
  | "sexo"
  | "tipoDocumento";

type TitularConfirmarRequiredField = {
  key: TitularConfirmarRequiredFieldKey;
  label: string;
};

const TITULAR_CONFIRMAR_REQUIRED_FIELDS: TitularConfirmarRequiredField[] = [
  { key: "tipoDocumento", label: "Tipo de documento" },
  { key: "nroDocumento", label: "Nro. de documento" },
  { key: "apellidoDenominacion", label: "Apellido/Denominación" },
  { key: "nombre", label: "Nombre" },
  { key: "fechaNacimiento", label: "Fecha de nacimiento" },
  { key: "sexo", label: "Sexo" },
  { key: "cuit", label: "CUIT" },
  { key: "email", label: "Email" },
  { key: "celular", label: "Celular" },
];

function validateTitularRequiredForConfirmar(
  values: EditableSolicitudCoreValues["titular"],
) {
  const missing = TITULAR_CONFIRMAR_REQUIRED_FIELDS.filter(
    (field) => !values[field.key]?.trim(),
  );

  return {
    errors: Object.fromEntries(
      missing.map((field) => [field.key, `${field.label} es requerido`]),
    ) as Partial<Record<keyof EditableSolicitudCoreValues["titular"], string>>,
    missingLabels: missing.map((field) => field.label),
  };
}

type SolicitanteTab = "adjuntos" | "cancelaciones" | "solicitante";
type SolicitanteContentTab = DatosPersonalesTab | "adjuntos" | "cancelaciones";

const SOLICITANTE_CONTENT_TABS: TabItem<SolicitanteContentTab>[] = [
  { label: "Datos Personales", value: "datosPersonales" },
  { label: "Cónyuge", value: "conyuge" },
  { label: "Económicos/Laborales", value: "economicosLaborales" },
  { label: "Adicionales", value: "adicionales" },
  { label: "Cancelaciones", value: "cancelaciones" },
  { label: "Adjuntos", value: "adjuntos" },
];

const CANCELACIONES_TABLE_COLUMNS = [
  "Cuenta a debitar",
  "CBU",
  "Monto",
  "Notas",
  "Socio",
  "Cuenta bancaria",
] as const;

type CancelacionesSectionProps = {
  canManageCancelaciones: boolean;
  isEditing: boolean;
  solicitudId: string;
};

function CancelacionesSection({
  canManageCancelaciones,
  isEditing,
  solicitudId,
}: CancelacionesSectionProps) {
  const { data: socios = [] } = useSociosCancelacionesQuery();
  const { data: cancelaciones = [] } =
    useSolicitudCoreCancelacionesQuery(solicitudId);
  const createCancelacionMutation =
    useCreateSolicitudCoreCancelacionMutation(solicitudId);
  const updateCancelacionMutation =
    useUpdateSolicitudCoreCancelacionMutation(solicitudId);
  const deleteCancelacionMutation =
    useDeleteSolicitudCoreCancelacionMutation(solicitudId);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCancelacion, setEditingCancelacion] =
    useState<SolicitudCoreCancelacionResponse | null>(null);

  const canManageRows = isEditing && canManageCancelaciones;
  const columnCount =
    CANCELACIONES_TABLE_COLUMNS.length + (canManageRows ? 1 : 0);

  function handleAdd() {
    setEditingCancelacion(null);
    setIsModalOpen(true);
  }

  function handleEdit(cancelacion: SolicitudCoreCancelacionResponse) {
    setEditingCancelacion(cancelacion);
    setIsModalOpen(true);
  }

  function handleDelete(cancelacion: SolicitudCoreCancelacionResponse) {
    deleteCancelacionMutation.mutate(cancelacion.id, {
      onError: () => {
        toast.error("No se pudo eliminar la cancelación.", {
          id: DELETE_CANCELACION_ERROR_TOAST_ID,
        });
      },
    });
  }

  function handleSave(values: NuevaCancelacionValues) {
    const payload = {
      cbu: values.cbu,
      cuentaADebitar: values.cuentaADebitar,
      cuentaBancaria: values.cuentaBancaria,
      monto: parseMoneyValue(values.monto),
      notas: values.notas,
      socio: values.socio,
      socioLegacyId: values.socioLegacyId || undefined,
    };

    if (editingCancelacion) {
      updateCancelacionMutation.mutate(
        { cancelacionId: editingCancelacion.id, ...payload },
        {
          onError: () => {
            toast.error("No se pudo actualizar la cancelación.", {
              id: UPDATE_CANCELACION_ERROR_TOAST_ID,
            });
          },
        },
      );
    } else {
      createCancelacionMutation.mutate(payload, {
        onError: () => {
          toast.error("No se pudo crear la cancelación.", {
            id: CREATE_CANCELACION_ERROR_TOAST_ID,
          });
        },
      });
    }
  }

  const modalDefaultValues: NuevaCancelacionValues | undefined =
    editingCancelacion
      ? {
          cbu: editingCancelacion.cbu,
          cuentaADebitar: editingCancelacion.cuentaADebitar,
          cuentaBancaria: editingCancelacion.cuentaBancaria,
          monto: formatMoneyValue(String(editingCancelacion.monto)),
          notas: editingCancelacion.notas ?? "",
          socio: editingCancelacion.socio,
          socioLegacyId: editingCancelacion.socioLegacyId ?? "",
        }
      : undefined;

  return (
    <div className="space-y-2">
      {canManageRows ? (
        <div className="flex items-center justify-end">
          <Button onClick={handleAdd} size="sm" type="button" variant="outline">
            <Plus className="size-4" />
            Nueva cancelación
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className="bg-background text-left text-xs text-foreground-secondary">
            <tr>
              {CANCELACIONES_TABLE_COLUMNS.map((column) => (
                <th
                  className="border-r border-border px-3 py-2 font-medium"
                  key={column}
                >
                  {column}
                </th>
              ))}
              {canManageRows ? (
                <th className="px-3 py-2 font-medium">Acciones</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {cancelaciones.length > 0 ? (
              cancelaciones.map((cancelacion) => (
                <tr className="border-t border-border" key={cancelacion.id}>
                  <td className="border-r border-border px-3 py-2">
                    {cancelacion.cuentaADebitar}
                  </td>
                  <td className="border-r border-border px-3 py-2">
                    {cancelacion.cbu}
                  </td>
                  <td className="border-r border-border px-3 py-2">
                    {formatNullableAmount(cancelacion.monto)}
                  </td>
                  <td className="border-r border-border px-3 py-2">
                    {cancelacion.notas || PLACEHOLDER}
                  </td>
                  <td className="border-r border-border px-3 py-2">
                    {cancelacion.socio}
                  </td>
                  <td
                    className={
                      canManageRows
                        ? "border-r border-border px-3 py-2"
                        : "px-3 py-2"
                    }
                  >
                    {cancelacion.cuentaBancaria}
                  </td>
                  {canManageRows ? (
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Button
                          onClick={() => handleEdit(cancelacion)}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          onClick={() => handleDelete(cancelacion)}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            ) : (
              <tr className="border-t border-border">
                <td className="px-3 py-3" colSpan={columnCount}>
                  <TableEmptyState message="Sin cancelaciones cargadas para mostrar." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canManageRows ? (
        <NuevaCancelacionModal
          defaultValues={modalDefaultValues}
          onOpenChange={setIsModalOpen}
          onSave={handleSave}
          open={isModalOpen}
          saveLabel={editingCancelacion ? "Guardar cambios" : "Guardar"}
          socios={socios}
          title={
            editingCancelacion ? "Editar Cancelación" : "Nueva Cancelación"
          }
        />
      ) : null}
    </div>
  );
}

type SolicitudDetailVistaTab = "evaluacion" | "solicitud";

const SOLICITUD_DETAIL_VISTA_TABS: TabItem<SolicitudDetailVistaTab>[] = [
  { label: "Solicitud", value: "solicitud" },
  { label: "Evaluación", value: "evaluacion" },
];

const SimuladorPrestamoModal = lazy(() =>
  loadSimuladorPrestamoModal().then((module) => ({
    default: module.SimuladorPrestamoModal,
  })),
);

const CalculadoraMutualSheet = lazy(() =>
  import("@/modules/riesgo/components/CalculadoraMutualSheet").then(
    (module) => ({ default: module.CalculadoraMutualSheet }),
  ),
);

type ReadOnlyFieldProps = {
  appearanceStyle?: CSSProperties;
  label: string;
  required?: boolean;
  value: ReactNode;
};

type EditableFieldProps = {
  appearanceStyle?: CSSProperties;
  editor: ReactNode;
  highlightReadOnly?: boolean;
  isEditing: boolean;
  label: string;
  required?: boolean;
  value: ReactNode;
};

type EditableTextInputProps = {
  appearanceStyle?: CSSProperties;
  disabled?: boolean;
  highlightReadOnly?: boolean;
  invalid?: boolean;
  isEditing: boolean;
  label: string;
  onChange: (value: string) => void;
  readOnlyValue: string;
  required?: boolean;
  type?: "date" | "email" | "number" | "text";
  value: string;
};

type EditableSelectInputProps = {
  appearanceStyle?: CSSProperties;
  disabled?: boolean;
  highlightReadOnly?: boolean;
  invalid?: boolean;
  isEditing: boolean;
  label: string;
  onChange: (value: string) => void;
  options: StyledSelectOption[];
  readOnlyValue: string;
  required?: boolean;
  value: string;
};

function formatText(value: string | null | undefined) {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : PLACEHOLDER;
}

function formatBoolean(value: boolean | null | undefined) {
  if (value === true) {
    return "Sí";
  }

  if (value === false) {
    return "No";
  }

  return PLACEHOLDER;
}

function formatAmount(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return PLACEHOLDER;
  }

  return `$${new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return PLACEHOLDER;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return PLACEHOLDER;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatTipoDocumento(value: string | null | undefined) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return PLACEHOLDER;
  }

  const match = TIPO_DOCUMENTO_OPTIONS.find(
    (option) => option.value === normalizedValue,
  );

  return match?.label ?? normalizedValue;
}

function formatWorkflowTransitionOptionLabel(
  transition: WorkflowTransition,
  currentStateCode?: string,
) {
  if (
    currentStateCode === "CargaVendedor" &&
    transition.toState.code === "Motor"
  ) {
    return FIRST_SUBMISSION_TRANSITION_LABEL;
  }

  return transition.toState.name;
}

function resolveAssignmentLabel(solicitud: SolicitudCoreResponse) {
  const fullName = solicitud.assignedToUser?.fullName?.trim();

  if (fullName) {
    return fullName;
  }

  const email = solicitud.assignedToUser?.email?.trim();

  if (email) {
    return email;
  }

  if (solicitud.assignedToUserId) {
    return "Asignado";
  }

  return "Sin asignar";
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return PLACEHOLDER;
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const kilobytes = value / 1024;

  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`;
  }

  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function parseLaborDate(value: string) {
  const normalizedValue = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizedValue);
  const localMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalizedValue);
  const match = isoMatch ?? localMatch;

  if (!match) {
    return null;
  }

  const year = Number(isoMatch ? match[1] : match[3]);
  const month = Number(match[2]);
  const day = Number(isoMatch ? match[3] : match[1]);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function calculateLaborMonths(fechaIngresoLaboral: string) {
  const startDate = parseLaborDate(fechaIngresoLaboral);

  if (!startDate) {
    return "";
  }

  const today = new Date();
  let months =
    (today.getFullYear() - startDate.getFullYear()) * 12 +
    today.getMonth() -
    startDate.getMonth();

  if (today.getDate() < startDate.getDate()) {
    months -= 1;
  }

  return String(Math.max(0, months));
}

function toEditableGarantiaRequest(
  garantia: SolicitudCoreGarantiaResponse,
): CreateSolicitudCoreGarantiaRequest {
  return {
    antiguedadLaboralMeses: garantia.antiguedadLaboralMeses ?? undefined,
    casadoConTitular: garantia.casadoConTitular ?? undefined,
    celular: garantia.celular ?? undefined,
    cuit: garantia.cuit ?? undefined,
    denominacion: garantia.denominacion ?? undefined,
    domicilio: garantia.domicilio ?? undefined,
    edad: garantia.edad ?? undefined,
    email: garantia.email ?? undefined,
    estadoCivil: garantia.estadoCivil ?? undefined,
    fechaIngresoLaboral: garantia.fechaIngresoLaboral ?? undefined,
    fechaNacimiento: garantia.fechaNacimiento ?? undefined,
    ingresoMensual: garantia.ingresoMensual ?? undefined,
    nacionalidad: garantia.nacionalidad ?? undefined,
    nombre: garantia.nombre ?? undefined,
    nombreCompleto: garantia.nombreCompleto ?? undefined,
    nroDocumento: garantia.nroDocumento ?? undefined,
    nroSocio: garantia.nroSocio ?? undefined,
    observaciones: garantia.observaciones ?? undefined,
    ocupacion: garantia.ocupacion ?? undefined,
    persona: garantia.persona ?? undefined,
    sexo: garantia.sexo ?? undefined,
    sumaIngresos: garantia.sumaIngresos,
    telefono: garantia.telefono ?? undefined,
    tipoDocumento: garantia.tipoDocumento ?? undefined,
    tipoGarantia: garantia.tipoGarantia ?? undefined,
    tipoRelacion: garantia.tipoRelacion ?? undefined,
  };
}

function hasMeaningfulLaborData(data: SolicitudCoreDatosLaboralesResponse) {
  return Object.values(data).some((value) => {
    if (typeof value === "string") {
      return value.trim().length > 0;
    }

    return value !== null;
  });
}

function resolveReadonlyFieldStyle(
  appearance?: SolicitudCoreAppearance,
): CSSProperties | undefined {
  if (!appearance?.backgroundColor && !appearance?.textColor) {
    return undefined;
  }

  return {
    ...(appearance?.backgroundColor
      ? {
          backgroundColor: appearance.backgroundColor,
          borderColor: appearance.backgroundColor,
        }
      : {}),
    ...(appearance?.textColor
      ? {
          color: appearance.textColor,
        }
      : {}),
  };
}

function ReadOnlyField({
  appearanceStyle,
  label,
  required,
  value,
}: ReadOnlyFieldProps) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground-secondary">
        {label}
        {required ? <RequiredMark /> : null}
      </span>
      <div
        className="min-h-9 rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-foreground"
        style={appearanceStyle}
      >
        {value}
      </div>
    </div>
  );
}

function EditableField({
  appearanceStyle,
  editor,
  highlightReadOnly = false,
  isEditing,
  label,
  required,
  value,
}: EditableFieldProps) {
  if (!isEditing) {
    return (
      <ReadOnlyField
        appearanceStyle={highlightReadOnly ? appearanceStyle : undefined}
        label={label}
        required={required}
        value={value}
      />
    );
  }

  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground-secondary">
        {label}
        {required ? <RequiredMark /> : null}
      </span>
      {editor}
    </div>
  );
}

function EditableTextInput({
  appearanceStyle,
  disabled = false,
  highlightReadOnly = false,
  invalid,
  isEditing,
  label,
  onChange,
  readOnlyValue,
  required,
  type = "text",
  value,
}: EditableTextInputProps) {
  return (
    <EditableField
      appearanceStyle={appearanceStyle}
      editor={
        <input
          aria-invalid={invalid || undefined}
          className={legacyFieldClassName}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          style={disabled ? appearanceStyle : undefined}
          type={type}
          value={value}
        />
      }
      highlightReadOnly={highlightReadOnly}
      isEditing={isEditing}
      label={label}
      required={required}
      value={readOnlyValue}
    />
  );
}

function EditableSelectInput({
  appearanceStyle,
  disabled = false,
  highlightReadOnly = false,
  invalid,
  isEditing,
  label,
  onChange,
  options,
  readOnlyValue,
  required,
  value,
}: EditableSelectInputProps) {
  return (
    <EditableField
      appearanceStyle={appearanceStyle}
      editor={
        <StyledSelect
          className={disabled ? "disabled:opacity-100" : undefined}
          disabled={disabled}
          emptyOptionLabel="---"
          invalid={invalid}
          onChange={onChange}
          options={options}
          placeholder="---"
          style={disabled ? appearanceStyle : undefined}
          value={value}
        />
      }
      highlightReadOnly={highlightReadOnly}
      isEditing={isEditing}
      label={label}
      required={required}
      value={readOnlyValue}
    />
  );
}

function EditableDateInput({
  appearanceStyle,
  disabled = false,
  highlightReadOnly = false,
  invalid,
  isEditing,
  label,
  onChange,
  readOnlyValue,
  required,
  value,
}: {
  appearanceStyle?: CSSProperties;
  disabled?: boolean;
  highlightReadOnly?: boolean;
  invalid?: boolean;
  isEditing: boolean;
  label: string;
  onChange: (value: string) => void;
  readOnlyValue: ReactNode;
  required?: boolean;
  value: string;
}) {
  return (
    <EditableField
      appearanceStyle={appearanceStyle}
      editor={
        <DateInput
          aria-invalid={invalid || undefined}
          className={legacyFieldClassName}
          disabled={disabled}
          onChange={onChange}
          style={disabled ? appearanceStyle : undefined}
          value={value}
        />
      }
      highlightReadOnly={highlightReadOnly}
      isEditing={isEditing}
      label={label}
      required={required}
      value={readOnlyValue}
    />
  );
}

function EditablePhoneInput({
  appearanceStyle,
  disabled = false,
  highlightReadOnly = false,
  invalid,
  isEditing,
  label,
  onChange,
  required,
  value,
}: {
  appearanceStyle?: CSSProperties;
  disabled?: boolean;
  highlightReadOnly?: boolean;
  invalid?: boolean;
  isEditing: boolean;
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  if (!isEditing) {
    return (
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground-secondary">
          {label}
          {required ? <RequiredMark /> : null}
        </span>
        {value.trim() ? (
          <StaticInternationalPhoneField
            disabled
            inputStyle={highlightReadOnly ? appearanceStyle : undefined}
            value={value}
          />
        ) : (
          <div
            className="min-h-9 rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-foreground"
            style={highlightReadOnly ? appearanceStyle : undefined}
          >
            {PLACEHOLDER}
          </div>
        )}
      </div>
    );
  }

  return (
    <EditableField
      appearanceStyle={appearanceStyle}
      editor={
        <StaticInternationalPhoneField
          disabled={disabled}
          inputStyle={disabled ? appearanceStyle : undefined}
          invalid={invalid}
          onChange={onChange}
          value={value}
        />
      }
      highlightReadOnly={highlightReadOnly}
      isEditing={isEditing}
      label={label}
      required={required}
      value={value}
    />
  );
}

function EditableMoneyInput({
  appearanceStyle,
  disabled = false,
  highlightReadOnly = false,
  isEditing,
  label,
  onChange,
  readOnlyValue,
  value,
}: {
  appearanceStyle?: CSSProperties;
  disabled?: boolean;
  highlightReadOnly?: boolean;
  isEditing: boolean;
  label: string;
  onChange: (value: string) => void;
  readOnlyValue: string;
  value: string;
}) {
  return (
    <EditableField
      appearanceStyle={appearanceStyle}
      editor={
        <StaticMoneyInput
          disabled={disabled}
          onChange={onChange}
          style={disabled ? appearanceStyle : undefined}
          value={value}
        />
      }
      highlightReadOnly={highlightReadOnly}
      isEditing={isEditing}
      label={label}
      value={readOnlyValue}
    />
  );
}

function DetailCard({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return <Section title={title}>{children}</Section>;
}

function SolicitudSection({
  assignmentOptions,
  assignmentValue,
  assignmentValueLabel,
  isFieldEditableByKey,
  isEditing,
  isExecutiveAssignmentDisabled,
  onAssignmentChange,
  onBooleanChange,
  onChange,
  readonlyAppearanceStyle,
  solicitud,
  ultimaNovedad,
  values,
}: {
  assignmentOptions: StyledSelectOption[];
  assignmentValue: string;
  assignmentValueLabel: string;
  isFieldEditableByKey: (fieldKey: string) => boolean;
  isEditing: boolean;
  isExecutiveAssignmentDisabled: boolean;
  onAssignmentChange: (value: string) => void;
  onBooleanChange: (
    field: keyof EditableSolicitudCoreValues["solicitud"],
    value: boolean,
  ) => void;
  onChange: (
    field: keyof EditableSolicitudCoreValues["solicitud"],
    value: string,
  ) => void;
  readonlyAppearanceStyle?: CSSProperties;
  solicitud: SolicitudCoreResponse;
  ultimaNovedad: string;
  values: EditableSolicitudCoreValues["solicitud"];
}) {
  function getReadonlyProps(fieldKey: string) {
    return {
      appearanceStyle: readonlyAppearanceStyle,
      highlightReadOnly: !isFieldEditableByKey(fieldKey),
    };
  }

  return (
    <DetailCard title="Solicitud">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ReadOnlyField
          label="Línea"
          value={formatText(solicitud.lineaPrestamoDescripcion)}
        />
        <EditableDateInput
          {...getReadonlyProps("solicitud.fechaPrimerVencimiento")}
          disabled={!isFieldEditableByKey("solicitud.fechaPrimerVencimiento")}
          isEditing={isEditing}
          label="Fecha primer vencimiento"
          onChange={(value) => onChange("fechaPrimerVencimiento", value)}
          readOnlyValue={formatDate(solicitud.fechaPrimerVencimiento)}
          value={values.fechaPrimerVencimiento}
        />
        <EditableTextInput
          {...getReadonlyProps("solicitud.nroOperacion")}
          disabled={!isFieldEditableByKey("solicitud.nroOperacion")}
          isEditing={isEditing}
          label="Nro operación"
          onChange={(value) => onChange("nroOperacion", value)}
          readOnlyValue={formatText(solicitud.nroOperacion)}
          value={values.nroOperacion}
        />
        <EditableMoneyInput
          {...getReadonlyProps("solicitud.cupoTitular")}
          disabled={!isFieldEditableByKey("solicitud.cupoTitular")}
          isEditing={isEditing}
          label="Cupo titular"
          onChange={(value) => onChange("cupoTitular", value)}
          readOnlyValue={formatAmount(solicitud.cupoTitular)}
          value={values.cupoTitular}
        />
        <EditableMoneyInput
          {...getReadonlyProps("solicitud.montoAFinanciar")}
          disabled={!isFieldEditableByKey("solicitud.montoAFinanciar")}
          isEditing={isEditing}
          label="Monto a financiar"
          onChange={(value) => onChange("montoAFinanciar", value)}
          readOnlyValue={formatAmount(solicitud.montoAFinanciar)}
          value={values.montoAFinanciar}
        />
        <EditableTextInput
          {...getReadonlyProps("solicitud.cuotas")}
          disabled={!isFieldEditableByKey("solicitud.cuotas")}
          isEditing={isEditing}
          label="Cuotas"
          onChange={(value) => onChange("cuotas", value)}
          readOnlyValue={
            solicitud.cuotas === null ? PLACEHOLDER : String(solicitud.cuotas)
          }
          type="number"
          value={values.cuotas}
        />
        <EditableTextInput
          {...getReadonlyProps("solicitud.cuotaResultante")}
          disabled={!isFieldEditableByKey("solicitud.cuotaResultante")}
          isEditing={isEditing}
          label="Cuota resultante"
          onChange={(value) => onChange("cuotaResultante", value)}
          readOnlyValue={formatText(solicitud.cuotaResultante)}
          value={values.cuotaResultante}
        />
        <EditableTextInput
          {...getReadonlyProps("solicitud.motivo")}
          disabled={!isFieldEditableByKey("solicitud.motivo")}
          isEditing={isEditing}
          label="Motivo"
          onChange={(value) => onChange("motivo", value)}
          readOnlyValue={formatText(solicitud.motivo)}
          value={values.motivo}
        />
        <EditableField
          editor={
            <StyledSelect
              disabled={isExecutiveAssignmentDisabled}
              onChange={onAssignmentChange}
              options={assignmentOptions}
              placeholder="Seleccionar ejecutivo"
              value={assignmentValue}
            />
          }
          isEditing={isEditing}
          label="Ejecutivo solicitud"
          value={assignmentValueLabel}
        />
        <EditableTextInput
          {...getReadonlyProps("solicitud.vendedorSolicitud")}
          disabled={!isFieldEditableByKey("solicitud.vendedorSolicitud")}
          isEditing={isEditing}
          label="Vendedor solicitud"
          onChange={(value) => onChange("vendedorSolicitud", value)}
          readOnlyValue={formatText(solicitud.vendedorSolicitud)}
          value={values.vendedorSolicitud}
        />
        <EditableField
          appearanceStyle={readonlyAppearanceStyle}
          editor={
            <label
              className="flex min-h-9 items-center gap-2 rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-foreground"
              style={
                !isFieldEditableByKey("solicitud.firmaDigitalmente")
                  ? readonlyAppearanceStyle
                  : undefined
              }
            >
              <Checkbox
                checked={values.firmaDigitalmente}
                className="size-5 rounded-md [&_svg]:size-4"
                disabled={!isFieldEditableByKey("solicitud.firmaDigitalmente")}
                onCheckedChange={(checked) =>
                  onBooleanChange("firmaDigitalmente", checked === true)
                }
              />
              Firma digitalmente
            </label>
          }
          highlightReadOnly={
            !isFieldEditableByKey("solicitud.firmaDigitalmente")
          }
          isEditing={isEditing}
          label="Firma digitalmente"
          value={formatBoolean(solicitud.firmaDigitalmente)}
        />
        <ReadOnlyField
          label="Creada"
          value={formatDateTime(solicitud.createdAt)}
        />
      </div>
      <div className="mt-3">
        <ReadOnlyField label="Última novedad" value={ultimaNovedad} />
      </div>
      <div className="mt-3">
        <ReadOnlyField
          label="Link firma digital"
          value={
            solicitud.linkFirmaDigital ? (
              <a
                className="break-all text-primary underline underline-offset-2"
                href={solicitud.linkFirmaDigital}
                rel="noreferrer"
                target="_blank"
              >
                {solicitud.linkFirmaDigital}
              </a>
            ) : (
              "El link estará disponible al generar préstamo"
            )
          }
        />
      </div>
      <div className="mt-3">
        <EditableField
          appearanceStyle={readonlyAppearanceStyle}
          editor={
            <textarea
              className={`${legacyFieldClassName} min-h-24 resize-none py-2`}
              disabled={!isFieldEditableByKey("solicitud.observaciones")}
              onChange={(event) =>
                onChange("observaciones", event.target.value)
              }
              style={
                !isFieldEditableByKey("solicitud.observaciones")
                  ? readonlyAppearanceStyle
                  : undefined
              }
              value={values.observaciones}
            />
          }
          highlightReadOnly={!isFieldEditableByKey("solicitud.observaciones")}
          isEditing={isEditing}
          label="Observaciones"
          value={formatText(solicitud.observaciones)}
        />
      </div>
    </DetailCard>
  );
}

function TitularFields({
  errors,
  isFieldEditableByKey,
  isEditing,
  onBooleanChange,
  onChange,
  readonlyAppearanceStyle,
  titular,
  values,
}: {
  errors?: Partial<
    Record<keyof EditableSolicitudCoreValues["titular"], string>
  >;
  isFieldEditableByKey: (fieldKey: string) => boolean;
  isEditing: boolean;
  onBooleanChange: (value: boolean) => void;
  onChange: (
    field: keyof EditableSolicitudCoreValues["titular"],
    value: string,
  ) => void;
  readonlyAppearanceStyle?: CSSProperties;
  titular: SolicitudCoreTitularResponse;
  values: EditableSolicitudCoreValues["titular"];
}) {
  function getReadonlyProps(fieldKey: string) {
    return {
      appearanceStyle: readonlyAppearanceStyle,
      highlightReadOnly: !isFieldEditableByKey(fieldKey),
    };
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <EditableSelectInput
        {...getReadonlyProps("titular.tipoDocumento")}
        disabled={!isFieldEditableByKey("titular.tipoDocumento")}
        invalid={!!errors?.tipoDocumento}
        isEditing={isEditing}
        label="Tipo documento"
        onChange={(value) => onChange("tipoDocumento", value)}
        options={TIPO_DOCUMENTO_OPTIONS}
        readOnlyValue={formatTipoDocumento(titular.tipoDocumento)}
        required
        value={values.tipoDocumento}
      />
      <EditableTextInput
        {...getReadonlyProps("titular.nroDocumento")}
        disabled={!isFieldEditableByKey("titular.nroDocumento")}
        invalid={!!errors?.nroDocumento}
        isEditing={isEditing}
        label="Nro documento"
        onChange={(value) => onChange("nroDocumento", value)}
        readOnlyValue={formatText(titular.nroDocumento)}
        required
        value={values.nroDocumento}
      />
      <EditableTextInput
        {...getReadonlyProps("titular.apellidoDenominacion")}
        disabled={!isFieldEditableByKey("titular.apellidoDenominacion")}
        invalid={!!errors?.apellidoDenominacion}
        isEditing={isEditing}
        label="Apellido/Denominación"
        onChange={(value) => onChange("apellidoDenominacion", value)}
        readOnlyValue={formatText(titular.apellidoDenominacion)}
        required
        value={values.apellidoDenominacion}
      />
      <EditableTextInput
        {...getReadonlyProps("titular.nombre")}
        disabled={!isFieldEditableByKey("titular.nombre")}
        invalid={!!errors?.nombre}
        isEditing={isEditing}
        label="Nombre"
        onChange={(value) => onChange("nombre", value)}
        readOnlyValue={formatText(titular.nombre)}
        required
        value={values.nombre}
      />
      <EditableDateInput
        {...getReadonlyProps("titular.fechaNacimiento")}
        disabled={!isFieldEditableByKey("titular.fechaNacimiento")}
        invalid={!!errors?.fechaNacimiento}
        isEditing={isEditing}
        label="Fecha nacimiento"
        onChange={(value) => onChange("fechaNacimiento", value)}
        readOnlyValue={formatDate(titular.fechaNacimiento)}
        required
        value={values.fechaNacimiento}
      />
      <ReadOnlyField
        label="Edad"
        value={calculateAge(
          values.fechaNacimiento || titular.fechaNacimiento || "",
        )}
      />
      <EditableTextInput
        {...getReadonlyProps("titular.cuit")}
        disabled={!isFieldEditableByKey("titular.cuit")}
        invalid={!!errors?.cuit}
        isEditing={isEditing}
        label="CUIT"
        onChange={(value) => onChange("cuit", value)}
        readOnlyValue={formatText(titular.cuit)}
        required
        value={values.cuit}
      />
      <EditableTextInput
        {...getReadonlyProps("titular.nroSocio")}
        disabled={!isFieldEditableByKey("titular.nroSocio")}
        isEditing={isEditing}
        label="Nro socio"
        onChange={(value) => onChange("nroSocio", value)}
        readOnlyValue={formatText(titular.nroSocio)}
        value={values.nroSocio}
      />
      <EditablePhoneInput
        {...getReadonlyProps("titular.celular")}
        disabled={!isFieldEditableByKey("titular.celular")}
        invalid={!!errors?.celular}
        isEditing={isEditing}
        label="Celular"
        onChange={(value) => onChange("celular", value)}
        required
        value={values.celular}
      />
      <EditablePhoneInput
        {...getReadonlyProps("titular.telefonoFijo")}
        disabled={!isFieldEditableByKey("titular.telefonoFijo")}
        isEditing={isEditing}
        label="Teléfono fijo"
        onChange={(value) => onChange("telefonoFijo", value)}
        value={values.telefonoFijo}
      />
      <EditableTextInput
        {...getReadonlyProps("titular.email")}
        disabled={!isFieldEditableByKey("titular.email")}
        invalid={!!errors?.email}
        isEditing={isEditing}
        label="Email"
        onChange={(value) => onChange("email", value)}
        readOnlyValue={formatText(titular.email)}
        required
        type="email"
        value={values.email}
      />
      <EditableSelectInput
        {...getReadonlyProps("titular.sexo")}
        disabled={!isFieldEditableByKey("titular.sexo")}
        invalid={!!errors?.sexo}
        isEditing={isEditing}
        label="Sexo"
        onChange={(value) => onChange("sexo", value)}
        options={SEXO_OPTIONS}
        readOnlyValue={formatText(titular.sexo)}
        required
        value={values.sexo}
      />
      <EditableTextInput
        {...getReadonlyProps("titular.nacionalidad")}
        disabled={!isFieldEditableByKey("titular.nacionalidad")}
        isEditing={isEditing}
        label="Nacionalidad"
        onChange={(value) => onChange("nacionalidad", value)}
        readOnlyValue={formatText(titular.nacionalidad)}
        value={values.nacionalidad}
      />
      <EditableField
        appearanceStyle={readonlyAppearanceStyle}
        editor={
          <label
            className="flex min-h-9 items-center gap-2 rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-foreground"
            style={
              !isFieldEditableByKey("titular.personaExpuestaPoliticamente")
                ? readonlyAppearanceStyle
                : undefined
            }
          >
            <Checkbox
              checked={values.personaExpuestaPoliticamente}
              className="size-5 rounded-md [&_svg]:size-4"
              disabled={
                !isFieldEditableByKey("titular.personaExpuestaPoliticamente")
              }
              onCheckedChange={(checked) => onBooleanChange(checked === true)}
            />
            Persona expuesta políticamente
          </label>
        }
        highlightReadOnly={
          !isFieldEditableByKey("titular.personaExpuestaPoliticamente")
        }
        isEditing={isEditing}
        label="Persona expuesta políticamente"
        value={formatBoolean(titular.personaExpuestaPoliticamente)}
      />
      <EditableSelectInput
        {...getReadonlyProps("titular.estadoCivil")}
        disabled={!isFieldEditableByKey("titular.estadoCivil")}
        isEditing={isEditing}
        label="Estado civil"
        onChange={(value) => onChange("estadoCivil", value)}
        options={ESTADO_CIVIL_OPTIONS}
        readOnlyValue={formatText(titular.estadoCivil)}
        value={values.estadoCivil}
      />
      <EditableTextInput
        {...getReadonlyProps("titular.domicilioCalle")}
        disabled={!isFieldEditableByKey("titular.domicilioCalle")}
        isEditing={isEditing}
        label="Domicilio calle"
        onChange={(value) => onChange("domicilioCalle", value)}
        readOnlyValue={formatText(titular.domicilioCalle)}
        value={values.domicilioCalle}
      />
      <EditableTextInput
        {...getReadonlyProps("titular.nroPuerta")}
        disabled={!isFieldEditableByKey("titular.nroPuerta")}
        isEditing={isEditing}
        label="Nro puerta"
        onChange={(value) => onChange("nroPuerta", value)}
        readOnlyValue={formatText(titular.nroPuerta)}
        value={values.nroPuerta}
      />
      <EditableTextInput
        {...getReadonlyProps("titular.localidad")}
        disabled={!isFieldEditableByKey("titular.localidad")}
        isEditing={isEditing}
        label="Localidad"
        onChange={(value) => onChange("localidad", value)}
        readOnlyValue={formatText(titular.localidad)}
        value={values.localidad}
      />
      <EditableTextInput
        {...getReadonlyProps("titular.cbu")}
        disabled={!isFieldEditableByKey("titular.cbu")}
        isEditing={isEditing}
        label="CBU"
        onChange={(value) => onChange("cbu", value)}
        readOnlyValue={formatText(titular.cbu)}
        value={values.cbu}
      />
    </div>
  );
}

function ConyugeFields({
  conyuge,
  isFieldEditableByKey,
  isEditing,
  onChange,
  readonlyAppearanceStyle,
  values,
}: {
  conyuge: SolicitudCoreConyugeResponse;
  isFieldEditableByKey: (fieldKey: string) => boolean;
  isEditing: boolean;
  onChange: (
    field: keyof NonNullable<EditableSolicitudCoreValues["conyuge"]>,
    value: string,
  ) => void;
  readonlyAppearanceStyle?: CSSProperties;
  values: NonNullable<EditableSolicitudCoreValues["conyuge"]>;
}) {
  function getReadonlyProps(fieldKey: string) {
    return {
      appearanceStyle: readonlyAppearanceStyle,
      highlightReadOnly: !isFieldEditableByKey(fieldKey),
    };
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <EditableTextInput
        {...getReadonlyProps("conyuge.apellido")}
        disabled={!isFieldEditableByKey("conyuge.apellido")}
        isEditing={isEditing}
        label="Apellido"
        onChange={(value) => onChange("apellido", value)}
        readOnlyValue={formatText(conyuge.apellido)}
        value={values.apellido}
      />
      <EditableTextInput
        {...getReadonlyProps("conyuge.nombre")}
        disabled={!isFieldEditableByKey("conyuge.nombre")}
        isEditing={isEditing}
        label="Nombre"
        onChange={(value) => onChange("nombre", value)}
        readOnlyValue={formatText(conyuge.nombre)}
        value={values.nombre}
      />
      <EditableSelectInput
        {...getReadonlyProps("conyuge.tipoDocumento")}
        disabled={!isFieldEditableByKey("conyuge.tipoDocumento")}
        isEditing={isEditing}
        label="Tipo documento"
        onChange={(value) => onChange("tipoDocumento", value)}
        options={TIPO_DOCUMENTO_OPTIONS}
        readOnlyValue={formatTipoDocumento(conyuge.tipoDocumento)}
        value={values.tipoDocumento}
      />
      <EditableTextInput
        {...getReadonlyProps("conyuge.nroDocumento")}
        disabled={!isFieldEditableByKey("conyuge.nroDocumento")}
        isEditing={isEditing}
        label="Nro documento"
        onChange={(value) => onChange("nroDocumento", value)}
        readOnlyValue={formatText(conyuge.nroDocumento)}
        value={values.nroDocumento}
      />
      <EditableSelectInput
        {...getReadonlyProps("conyuge.sexo")}
        disabled={!isFieldEditableByKey("conyuge.sexo")}
        isEditing={isEditing}
        label="Sexo"
        onChange={(value) => onChange("sexo", value)}
        options={SEXO_OPTIONS}
        readOnlyValue={formatText(conyuge.sexo)}
        value={values.sexo}
      />
      <EditableDateInput
        {...getReadonlyProps("conyuge.fechaNacimiento")}
        disabled={!isFieldEditableByKey("conyuge.fechaNacimiento")}
        isEditing={isEditing}
        label="Fecha nacimiento"
        onChange={(value) => onChange("fechaNacimiento", value)}
        readOnlyValue={formatDate(conyuge.fechaNacimiento)}
        value={values.fechaNacimiento}
      />
      <EditableTextInput
        {...getReadonlyProps("conyuge.actividad")}
        disabled={!isFieldEditableByKey("conyuge.actividad")}
        isEditing={isEditing}
        label="Actividad"
        onChange={(value) => onChange("actividad", value)}
        readOnlyValue={formatText(conyuge.actividad)}
        value={values.actividad}
      />
      <EditableMoneyInput
        {...getReadonlyProps("conyuge.ingresosMensuales")}
        disabled={!isFieldEditableByKey("conyuge.ingresosMensuales")}
        isEditing={isEditing}
        label="Ingresos mensuales"
        onChange={(value) => onChange("ingresosMensuales", value)}
        readOnlyValue={formatAmount(conyuge.ingresosMensuales)}
        value={values.ingresosMensuales}
      />
      <EditableTextInput
        {...getReadonlyProps("conyuge.nacionalidad")}
        disabled={!isFieldEditableByKey("conyuge.nacionalidad")}
        isEditing={isEditing}
        label="Nacionalidad"
        onChange={(value) => onChange("nacionalidad", value)}
        readOnlyValue={formatText(conyuge.nacionalidad)}
        value={values.nacionalidad}
      />
    </div>
  );
}

function DatosLaboralesFields({
  datosLaborales,
  isFieldEditableByKey,
  isEditing,
  onChange,
  readonlyAppearanceStyle,
  values,
}: {
  datosLaborales: SolicitudCoreDatosLaboralesResponse;
  isFieldEditableByKey: (fieldKey: string) => boolean;
  isEditing: boolean;
  onChange: (
    field: keyof EditableSolicitudCoreValues["datosLaborales"],
    value: string,
  ) => void;
  readonlyAppearanceStyle?: CSSProperties;
  values: EditableSolicitudCoreValues["datosLaborales"];
}) {
  function getReadonlyProps(fieldKey: string) {
    return {
      appearanceStyle: readonlyAppearanceStyle,
      highlightReadOnly: !isFieldEditableByKey(fieldKey),
    };
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <EditableTextInput
        {...getReadonlyProps("datosLaborales.empleador")}
        disabled={!isFieldEditableByKey("datosLaborales.empleador")}
        isEditing={isEditing}
        label="Empleador"
        onChange={(value) => onChange("empleador", value)}
        readOnlyValue={formatText(datosLaborales.empleador)}
        value={values.empleador}
      />
      <EditableTextInput
        {...getReadonlyProps("datosLaborales.actividadLaboral")}
        disabled={!isFieldEditableByKey("datosLaborales.actividadLaboral")}
        isEditing={isEditing}
        label="Actividad laboral"
        onChange={(value) => onChange("actividadLaboral", value)}
        readOnlyValue={formatText(datosLaborales.actividadLaboral)}
        value={values.actividadLaboral}
      />
      <EditableTextInput
        {...getReadonlyProps("datosLaborales.relacionLaboral")}
        disabled={!isFieldEditableByKey("datosLaborales.relacionLaboral")}
        isEditing={isEditing}
        label="Relación laboral"
        onChange={(value) => onChange("relacionLaboral", value)}
        readOnlyValue={formatText(datosLaborales.relacionLaboral)}
        value={values.relacionLaboral}
      />
      <EditableTextInput
        {...getReadonlyProps("datosLaborales.antiguedadLaboralMeses")}
        disabled={
          !isFieldEditableByKey("datosLaborales.antiguedadLaboralMeses")
        }
        isEditing={isEditing}
        label="Antigüedad laboral meses"
        onChange={(value) => onChange("antiguedadLaboralMeses", value)}
        readOnlyValue={
          datosLaborales.antiguedadLaboralMeses === null
            ? PLACEHOLDER
            : String(datosLaborales.antiguedadLaboralMeses)
        }
        type="number"
        value={values.antiguedadLaboralMeses}
      />
      <EditableDateInput
        {...getReadonlyProps("datosLaborales.fechaIngresoLaboral")}
        disabled={!isFieldEditableByKey("datosLaborales.fechaIngresoLaboral")}
        isEditing={isEditing}
        label="Fecha ingreso laboral"
        onChange={(value) => onChange("fechaIngresoLaboral", value)}
        readOnlyValue={formatDate(datosLaborales.fechaIngresoLaboral)}
        value={values.fechaIngresoLaboral}
      />
      <EditableMoneyInput
        {...getReadonlyProps("datosLaborales.montoRecibo")}
        disabled={!isFieldEditableByKey("datosLaborales.montoRecibo")}
        isEditing={isEditing}
        label="Monto recibo"
        onChange={(value) => onChange("montoRecibo", value)}
        readOnlyValue={formatAmount(datosLaborales.montoRecibo)}
        value={values.montoRecibo}
      />
      <EditableMoneyInput
        {...getReadonlyProps("datosLaborales.descuentosSueldo")}
        disabled={!isFieldEditableByKey("datosLaborales.descuentosSueldo")}
        isEditing={isEditing}
        label="Descuentos sueldo"
        onChange={(value) => onChange("descuentosSueldo", value)}
        readOnlyValue={formatAmount(datosLaborales.descuentosSueldo)}
        value={values.descuentosSueldo}
      />
      <EditableTextInput
        {...getReadonlyProps("datosLaborales.domicilioLaboralCalle")}
        disabled={!isFieldEditableByKey("datosLaborales.domicilioLaboralCalle")}
        isEditing={isEditing}
        label="Domicilio laboral calle"
        onChange={(value) => onChange("domicilioLaboralCalle", value)}
        readOnlyValue={formatText(datosLaborales.domicilioLaboralCalle)}
        value={values.domicilioLaboralCalle}
      />
      <EditableTextInput
        {...getReadonlyProps("datosLaborales.domicilioLaboralNroPuerta")}
        disabled={
          !isFieldEditableByKey("datosLaborales.domicilioLaboralNroPuerta")
        }
        isEditing={isEditing}
        label="Nro puerta laboral"
        onChange={(value) => onChange("domicilioLaboralNroPuerta", value)}
        readOnlyValue={formatText(datosLaborales.domicilioLaboralNroPuerta)}
        value={values.domicilioLaboralNroPuerta}
      />
      <EditableTextInput
        {...getReadonlyProps("datosLaborales.domicilioLaboralPisoDepto")}
        disabled={
          !isFieldEditableByKey("datosLaborales.domicilioLaboralPisoDepto")
        }
        isEditing={isEditing}
        label="Piso/Depto laboral"
        onChange={(value) => onChange("domicilioLaboralPisoDepto", value)}
        readOnlyValue={formatText(datosLaborales.domicilioLaboralPisoDepto)}
        value={values.domicilioLaboralPisoDepto}
      />
      <EditableTextInput
        {...getReadonlyProps("datosLaborales.domicilioLaboralLocalidad")}
        disabled={
          !isFieldEditableByKey("datosLaborales.domicilioLaboralLocalidad")
        }
        isEditing={isEditing}
        label="Localidad laboral"
        onChange={(value) => onChange("domicilioLaboralLocalidad", value)}
        readOnlyValue={formatText(datosLaborales.domicilioLaboralLocalidad)}
        value={values.domicilioLaboralLocalidad}
      />
      <EditableTextInput
        {...getReadonlyProps("datosLaborales.tarjetas")}
        disabled={!isFieldEditableByKey("datosLaborales.tarjetas")}
        isEditing={isEditing}
        label="Tarjetas"
        onChange={(value) => onChange("tarjetas", value)}
        readOnlyValue={formatText(datosLaborales.tarjetas)}
        value={values.tarjetas}
      />
      <EditableTextInput
        {...getReadonlyProps("datosLaborales.vehiculo")}
        disabled={!isFieldEditableByKey("datosLaborales.vehiculo")}
        isEditing={isEditing}
        label="Vehículo"
        onChange={(value) => onChange("vehiculo", value)}
        readOnlyValue={formatText(datosLaborales.vehiculo)}
        value={values.vehiculo}
      />
      <EditableTextInput
        {...getReadonlyProps("datosLaborales.vivienda")}
        disabled={!isFieldEditableByKey("datosLaborales.vivienda")}
        isEditing={isEditing}
        label="Vivienda"
        onChange={(value) => onChange("vivienda", value)}
        readOnlyValue={formatText(datosLaborales.vivienda)}
        value={values.vivienda}
      />
    </div>
  );
}

function AdjuntosSection({
  adjuntos,
  canCreateAdjunto,
  canDeleteAdjunto,
  canDownloadAdjunto,
  deletingAdjuntoId,
  downloadingAdjuntoId,
  editingAdjuntoId,
  embedded = false,
  errorMessage,
  isLoading,
  isUploading,
  onDeleteAdjunto,
  onDownloadAdjunto,
  onEditAdjunto,
  onNewAdjuntosLote,
  onPreviewAdjunto,
  previewingAdjuntoId,
}: {
  adjuntos: SolicitudCoreAdjuntoResponse[];
  canCreateAdjunto: boolean;
  canDeleteAdjunto: boolean;
  canDownloadAdjunto: boolean;
  deletingAdjuntoId: string | null;
  downloadingAdjuntoId: string | null;
  editingAdjuntoId?: string | null;
  embedded?: boolean;
  errorMessage?: string;
  isLoading: boolean;
  isUploading: boolean;
  onDeleteAdjunto: (adjunto: SolicitudCoreAdjuntoResponse) => Promise<void>;
  onDownloadAdjunto: (adjunto: SolicitudCoreAdjuntoResponse) => Promise<void>;
  onEditAdjunto?: (adjunto: SolicitudCoreAdjuntoResponse) => void;
  onNewAdjuntosLote: (items: AdjuntoLoteItem[]) => Promise<boolean>;
  onPreviewAdjunto?: (adjunto: SolicitudCoreAdjuntoResponse) => void;
  previewingAdjuntoId?: string | null;
}) {
  const [isAdjuntoModalOpen, setIsAdjuntoModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [selectedAdjuntoIds, setSelectedAdjuntoIds] = useState<Set<string>>(
    () => new Set(),
  );
  const selectedAdjuntoIdsSet = useMemo(() => {
    if (selectedAdjuntoIds.size === 0) {
      return selectedAdjuntoIds;
    }

    const availableIds = new Set(adjuntos.map((adjunto) => adjunto.id));
    const nextSelection = new Set<string>();
    selectedAdjuntoIds.forEach((id) => {
      if (availableIds.has(id)) {
        nextSelection.add(id);
      }
    });

    return nextSelection.size === selectedAdjuntoIds.size
      ? selectedAdjuntoIds
      : nextSelection;
  }, [adjuntos, selectedAdjuntoIds]);
  const selectedAdjuntos = useMemo(
    () => adjuntos.filter((adjunto) => selectedAdjuntoIdsSet.has(adjunto.id)),
    [adjuntos, selectedAdjuntoIdsSet],
  );
  const selectedAdjuntosCount = selectedAdjuntos.length;
  const hasSelectedAdjuntos = selectedAdjuntosCount > 0;
  const allAdjuntosSelected =
    adjuntos.length > 0 &&
    adjuntos.every((adjunto) => selectedAdjuntoIdsSet.has(adjunto.id));

  function toggleAllAdjuntos(checked: boolean) {
    if (checked) {
      setSelectedAdjuntoIds(new Set(adjuntos.map((adjunto) => adjunto.id)));
      return;
    }

    setSelectedAdjuntoIds(new Set());
  }

  function toggleAdjuntoSelection(adjuntoId: string, checked: boolean) {
    setSelectedAdjuntoIds((current) => {
      const nextSelection = new Set(current);

      if (checked) {
        nextSelection.add(adjuntoId);
      } else {
        nextSelection.delete(adjuntoId);
      }

      return nextSelection;
    });
  }

  async function handleDownloadSelectedAdjunto() {
    if (selectedAdjuntos.length === 0) {
      return;
    }

    for (const selectedAdjunto of selectedAdjuntos) {
      await onDownloadAdjunto(selectedAdjunto);
    }
  }

  async function handleDeleteSelectedAdjuntos() {
    if (selectedAdjuntos.length === 0) {
      return;
    }
    let allDeleted = true;

    for (const adjunto of selectedAdjuntos) {
      try {
        await onDeleteAdjunto(adjunto);
      } catch {
        allDeleted = false;
        break;
      }
    }

    setSelectedAdjuntoIds((current) => {
      const nextSelection = new Set(current);
      selectedAdjuntos.forEach((adjunto) => nextSelection.delete(adjunto.id));
      return nextSelection;
    });

    if (allDeleted) {
      setIsDeleteConfirmOpen(false);
    }
  }

  const content = (
    <div className="space-y-3">
      {canCreateAdjunto || canDownloadAdjunto || canDeleteAdjunto ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {canCreateAdjunto ? (
              <Button
                disabled={isUploading}
                onClick={() => setIsAdjuntoModalOpen(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus className="size-4" />
                Agregar adjunto
              </Button>
            ) : null}
            <span className="text-xs text-foreground-secondary">
              {hasSelectedAdjuntos
                ? `${selectedAdjuntosCount} seleccionado${selectedAdjuntosCount === 1 ? "" : "s"}`
                : "Sin seleccion"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canDownloadAdjunto ? (
              <Button
                className={`transition-opacity duration-200 ${
                  downloadingAdjuntoId !== null &&
                  selectedAdjuntoIdsSet.has(downloadingAdjuntoId)
                    ? "opacity-85"
                    : ""
                }`}
                disabled={
                  !hasSelectedAdjuntos ||
                  (downloadingAdjuntoId !== null &&
                    selectedAdjuntoIdsSet.has(downloadingAdjuntoId))
                }
                onClick={() => void handleDownloadSelectedAdjunto()}
                size="sm"
                type="button"
                variant="outline"
              >
                <Download className="size-4" />
                {downloadingAdjuntoId !== null &&
                selectedAdjuntoIdsSet.has(downloadingAdjuntoId)
                  ? "Descargando..."
                  : selectedAdjuntosCount > 1
                    ? "Descargar seleccionados"
                    : "Descargar"}
              </Button>
            ) : null}
            {canDeleteAdjunto ? (
              <Button
                disabled={
                  !hasSelectedAdjuntos ||
                  (deletingAdjuntoId !== null &&
                    selectedAdjuntoIdsSet.has(deletingAdjuntoId))
                }
                onClick={() => setIsDeleteConfirmOpen(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Trash2 className="size-4" />
                {deletingAdjuntoId !== null &&
                selectedAdjuntoIdsSet.has(deletingAdjuntoId)
                  ? "Eliminando..."
                  : "Eliminar"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="bg-background text-left text-xs text-foreground-secondary">
            <tr>
              <th className="border-r border-border px-3 py-2 font-medium">
                <Checkbox
                  checked={allAdjuntosSelected}
                  disabled={adjuntos.length === 0}
                  onCheckedChange={(checked) =>
                    toggleAllAdjuntos(checked === true)
                  }
                />
              </th>
              <th className="border-r border-border px-3 py-2 font-medium">
                Archivo
              </th>
              <th className="border-r border-border px-3 py-2 font-medium">
                Tipo adjunto
              </th>
              <th className="border-r border-border px-3 py-2 font-medium">
                Descripción
              </th>
              <th className="border-r border-border px-3 py-2 font-medium">
                Estado
              </th>
              <th className="border-r border-border px-3 py-2 font-medium">
                Tamaño
              </th>
              <th className="border-r border-border px-3 py-2 font-medium">
                Subido por
              </th>
              <th className="border-r border-border px-3 py-2 font-medium">
                Fecha subida
              </th>
              <th className="px-3 py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr className="border-t border-border">
                <td
                  className="px-3 py-4 text-sm text-foreground-secondary"
                  colSpan={9}
                >
                  Cargando adjuntos...
                </td>
              </tr>
            ) : errorMessage ? (
              <tr className="border-t border-border">
                <td className="px-3 py-4 text-sm text-danger" colSpan={9}>
                  {errorMessage}
                </td>
              </tr>
            ) : adjuntos.length > 0 ? (
              adjuntos.map((adjunto) => (
                <tr className="border-t border-border" key={adjunto.id}>
                  <td className="border-r border-border px-3 py-2">
                    <Checkbox
                      checked={selectedAdjuntoIdsSet.has(adjunto.id)}
                      onCheckedChange={(checked) =>
                        toggleAdjuntoSelection(adjunto.id, checked === true)
                      }
                    />
                  </td>
                  <td className="border-r border-border px-3 py-2">
                    {formatText(adjunto.archivoNombre)}
                  </td>
                  <td className="border-r border-border px-3 py-2">
                    {formatText(adjunto.tipoAdjunto)}
                  </td>
                  <td className="border-r border-border px-3 py-2">
                    {formatText(adjunto.descripcion)}
                  </td>
                  <td className="border-r border-border px-3 py-2">
                    {formatText(adjunto.estadoAdjunto)}
                  </td>
                  <td className="border-r border-border px-3 py-2">
                    {formatBytes(adjunto.archivoSizeBytes)}
                  </td>
                  <td className="border-r border-border px-3 py-2">
                    {formatText(adjunto.uploadedByName ?? adjunto.uploadedBy)}
                  </td>
                  <td className="border-r border-border px-3 py-2">
                    {formatDateTime(adjunto.uploadedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {onPreviewAdjunto ? (
                        <Button
                          className="size-7 text-foreground-secondary"
                          disabled={previewingAdjuntoId === adjunto.id}
                          onClick={() => onPreviewAdjunto(adjunto)}
                          size="icon-sm"
                          title="Previsualizar"
                          type="button"
                          variant="outline"
                        >
                          <Eye className="size-3.5" />
                        </Button>
                      ) : null}
                      {onEditAdjunto ? (
                        <Button
                          className="size-7 text-foreground-secondary"
                          disabled={editingAdjuntoId === adjunto.id}
                          onClick={() => onEditAdjunto(adjunto)}
                          size="icon-sm"
                          title="Reemplazar"
                          type="button"
                          variant="outline"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr className="border-t border-border">
                <td className="px-3 py-3" colSpan={9}>
                  <TableEmptyState />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <DialogRoot
        onOpenChange={setIsDeleteConfirmOpen}
        open={isDeleteConfirmOpen}
      >
        <DialogContent className="max-w-[440px] p-0">
          <div className="space-y-3 p-4">
            <DialogTitle className="text-base font-semibold text-foreground">
              Eliminar adjunto
            </DialogTitle>
            <DialogDescription className="text-sm text-foreground-secondary">
              {selectedAdjuntosCount === 1
                ? "Seguro que querés eliminar el adjunto seleccionado? Esta acción no se puede deshacer."
                : "Seguro que querés eliminar los adjuntos seleccionados? Esta acción no se puede deshacer."}
            </DialogDescription>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                disabled={deletingAdjuntoId !== null}
                onClick={() => setIsDeleteConfirmOpen(false)}
                type="button"
                variant="outline"
              >
                Cancelar
              </Button>
              <Button
                className="bg-danger text-danger-foreground hover:bg-danger/90"
                disabled={
                  !hasSelectedAdjuntos ||
                  (deletingAdjuntoId !== null &&
                    selectedAdjuntoIdsSet.has(deletingAdjuntoId))
                }
                onClick={() => void handleDeleteSelectedAdjuntos()}
                type="button"
              >
                {deletingAdjuntoId !== null &&
                selectedAdjuntoIdsSet.has(deletingAdjuntoId)
                  ? "Eliminando..."
                  : "Eliminar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </DialogRoot>
    </div>
  );

  return (
    <>
      {embedded ? content : <DetailCard title="Adjuntos">{content}</DetailCard>}
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
    </>
  );
}

function SolicitanteSection({
  activeTab,
  adjuntos,
  canCreateAdicional,
  canCreateAdjunto,
  canDeleteAdjunto,
  canDownloadAdjunto,
  canManageCancelaciones,
  datosPersonalesTab,
  datosLaborales,
  deletingAdjuntoId,
  downloadingAdjuntoId,
  editingAdjuntoId,
  errorMessage,
  isFieldEditableByKey,
  isGarantiasFullyEditable,
  isGarantiasPartiallyEditable,
  isEditing,
  isLoadingAdjuntos,
  isUploadingAdjunto,
  garantias,
  onConyugeChange,
  onDatosLaboralesChange,
  onDatosPersonalesTabChange,
  onDeleteAdjunto,
  onDownloadAdjunto,
  onEditAdjunto,
  onGarantiaCreate,
  onGarantiaEdit,
  onNewAdjuntosLote,
  onPreviewAdjunto,
  previewingAdjuntoId,
  onTabChange,
  onTitularBooleanChange,
  onTitularChange,
  readonlyAppearanceStyle,
  shouldShowDatosLaborales,
  solicitudId,
  titular,
  titularDatosLaboralesValues,
  titularConyuge,
  titularConyugeValues,
  titularErrors,
  titularValues,
}: {
  activeTab: SolicitanteTab;
  adjuntos: SolicitudCoreAdjuntoResponse[];
  canCreateAdicional: boolean;
  canCreateAdjunto: boolean;
  canDeleteAdjunto: boolean;
  canDownloadAdjunto: boolean;
  canManageCancelaciones: boolean;
  datosPersonalesTab: DatosPersonalesTab;
  datosLaborales: SolicitudCoreDatosLaboralesResponse;
  deletingAdjuntoId: string | null;
  downloadingAdjuntoId: string | null;
  errorMessage?: string;
  isFieldEditableByKey: (fieldKey: string) => boolean;
  isGarantiasFullyEditable: boolean;
  isGarantiasPartiallyEditable: boolean;
  isEditing: boolean;
  editingAdjuntoId?: string | null;
  isLoadingAdjuntos: boolean;
  isUploadingAdjunto: boolean;
  garantias: CreateSolicitudCoreGarantiaRequest[];
  onConyugeChange: (
    field: keyof NonNullable<EditableSolicitudCoreValues["conyuge"]>,
    value: string,
  ) => void;
  onDatosLaboralesChange: (
    field: keyof EditableSolicitudCoreValues["datosLaborales"],
    value: string,
  ) => void;
  onDatosPersonalesTabChange: (tab: DatosPersonalesTab) => void;
  onDeleteAdjunto: (adjunto: SolicitudCoreAdjuntoResponse) => Promise<void>;
  onDownloadAdjunto: (adjunto: SolicitudCoreAdjuntoResponse) => Promise<void>;
  onEditAdjunto?: (adjunto: SolicitudCoreAdjuntoResponse) => void;
  onGarantiaCreate: () => void;
  onGarantiaEdit: (index: number) => void;
  onNewAdjuntosLote: (items: AdjuntoLoteItem[]) => Promise<boolean>;
  onPreviewAdjunto?: (adjunto: SolicitudCoreAdjuntoResponse) => void;
  previewingAdjuntoId?: string | null;
  onTabChange: (tab: SolicitanteTab) => void;
  onTitularBooleanChange: (value: boolean) => void;
  onTitularChange: (
    field: keyof EditableSolicitudCoreValues["titular"],
    value: string,
  ) => void;
  readonlyAppearanceStyle?: CSSProperties;
  shouldShowDatosLaborales: boolean;
  solicitudId: string;
  titular: SolicitudCoreTitularResponse;
  titularDatosLaboralesValues: EditableSolicitudCoreValues["datosLaborales"];
  titularConyuge: SolicitudCoreConyugeResponse | null;
  titularConyugeValues: NonNullable<
    EditableSolicitudCoreValues["conyuge"]
  > | null;
  titularErrors?: Partial<
    Record<keyof EditableSolicitudCoreValues["titular"], string>
  >;
  titularValues: EditableSolicitudCoreValues["titular"];
}) {
  const activeContentTab: SolicitanteContentTab =
    activeTab === "adjuntos" || activeTab === "cancelaciones"
      ? activeTab
      : datosPersonalesTab;
  const [selectedGarantiaIndexes, setSelectedGarantiaIndexes] = useState<
    Set<number>
  >(() => new Set());
  const selectedGarantiaIndexesSet = useMemo(() => {
    if (
      activeContentTab !== "adicionales" ||
      selectedGarantiaIndexes.size === 0
    ) {
      return new Set<number>();
    }

    const nextSelection = new Set<number>();
    selectedGarantiaIndexes.forEach((index) => {
      if (index >= 0 && index < garantias.length) {
        nextSelection.add(index);
      }
    });

    return nextSelection.size === selectedGarantiaIndexes.size
      ? selectedGarantiaIndexes
      : nextSelection;
  }, [activeContentTab, garantias.length, selectedGarantiaIndexes]);
  const selectedGarantiasCount = selectedGarantiaIndexesSet.size;
  const hasSelectedGarantias = selectedGarantiasCount > 0;
  const hasExactlyOneSelectedGarantia = selectedGarantiasCount === 1;
  const allGarantiasSelected =
    garantias.length > 0 &&
    garantias.every((_, index) => selectedGarantiaIndexesSet.has(index));

  function toggleGarantiaSelection(index: number, checked: boolean) {
    setSelectedGarantiaIndexes((current) => {
      const nextSelection = new Set(current);
      if (checked) {
        nextSelection.add(index);
      } else {
        nextSelection.delete(index);
      }
      return nextSelection;
    });
  }

  function toggleAllGarantias(checked: boolean) {
    if (checked) {
      setSelectedGarantiaIndexes(new Set(garantias.map((_, index) => index)));
      return;
    }

    setSelectedGarantiaIndexes(new Set());
  }

  function handleEditSelectedGarantia() {
    if (!hasExactlyOneSelectedGarantia) {
      return;
    }

    const [selectedIndex] = Array.from(selectedGarantiaIndexesSet);
    if (selectedIndex === undefined) {
      return;
    }

    onGarantiaEdit(selectedIndex);
  }

  return (
    <DetailCard title="Solicitante">
      <SectionTabs<SolicitanteContentTab>
        activeTab={activeContentTab}
        onTabChange={(tab) => {
          if (tab === "adjuntos" || tab === "cancelaciones") {
            onTabChange(tab);
            return;
          }

          onTabChange("solicitante");
          onDatosPersonalesTabChange(tab);
        }}
        tabs={SOLICITANTE_CONTENT_TABS}
      />
      {activeContentTab === "cancelaciones" ? (
        <CancelacionesSection
          canManageCancelaciones={canManageCancelaciones}
          isEditing={isEditing}
          solicitudId={solicitudId}
        />
      ) : activeContentTab !== "adjuntos" ? (
        <div>
          {activeContentTab === "datosPersonales" ? (
            <TitularFields
              errors={titularErrors}
              isFieldEditableByKey={isFieldEditableByKey}
              isEditing={isEditing}
              onBooleanChange={onTitularBooleanChange}
              onChange={onTitularChange}
              readonlyAppearanceStyle={readonlyAppearanceStyle}
              titular={titular}
              values={titularValues}
            />
          ) : null}
          {activeContentTab === "conyuge" ? (
            titularConyuge && titularConyugeValues ? (
              <ConyugeFields
                conyuge={titularConyuge}
                isFieldEditableByKey={isFieldEditableByKey}
                isEditing={isEditing}
                onChange={onConyugeChange}
                readonlyAppearanceStyle={readonlyAppearanceStyle}
                values={titularConyugeValues}
              />
            ) : (
              <div className="rounded-md border border-dashed border-border bg-background px-3 py-8 text-center text-sm text-foreground-muted">
                Sin datos de conyuge para mostrar.
              </div>
            )
          ) : null}
          {activeContentTab === "economicosLaborales" ? (
            shouldShowDatosLaborales ? (
              <DatosLaboralesFields
                datosLaborales={datosLaborales}
                isFieldEditableByKey={isFieldEditableByKey}
                isEditing={isEditing}
                onChange={onDatosLaboralesChange}
                readonlyAppearanceStyle={readonlyAppearanceStyle}
                values={titularDatosLaboralesValues}
              />
            ) : (
              <div className="rounded-md border border-dashed border-border bg-background px-3 py-8 text-center text-sm text-foreground-muted">
                Sin datos economicos/laborales para mostrar.
              </div>
            )
          ) : null}
          {activeContentTab === "adicionales" ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  {canCreateAdicional ? (
                    <Button
                      disabled={!isGarantiasFullyEditable}
                      onClick={onGarantiaCreate}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Plus className="size-4" />
                      Agregar adicional
                    </Button>
                  ) : null}
                  <span className="text-xs text-foreground-secondary">
                    {hasSelectedGarantias
                      ? `${selectedGarantiasCount} seleccionado${selectedGarantiasCount === 1 ? "" : "s"}`
                      : "Sin seleccion"}
                  </span>
                </div>
                <Button
                  disabled={
                    !hasExactlyOneSelectedGarantia ||
                    !isEditing ||
                    !isGarantiasPartiallyEditable
                  }
                  onClick={handleEditSelectedGarantia}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Pencil className="size-4" />
                  Editar
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[1320px] border-collapse text-sm">
                  <thead className="bg-background text-left text-xs text-foreground-secondary">
                    <tr>
                      <th className="border-r border-border px-3 py-2 font-medium">
                        <Checkbox
                          checked={allGarantiasSelected}
                          disabled={
                            !isEditing ||
                            !isGarantiasPartiallyEditable ||
                            garantias.length === 0
                          }
                          onCheckedChange={(checked) =>
                            toggleAllGarantias(checked === true)
                          }
                        />
                      </th>
                      <th className="border-r border-border px-3 py-2 font-medium">
                        Tipo relación
                      </th>
                      <th className="border-r border-border px-3 py-2 font-medium">
                        Tipo garantía
                      </th>
                      <th className="border-r border-border px-3 py-2 font-medium">
                        Nombre completo / denominación
                      </th>
                      <th className="border-r border-border px-3 py-2 font-medium">
                        Documento
                      </th>
                      <th className="border-r border-border px-3 py-2 font-medium">
                        CUIT
                      </th>
                      <th className="border-r border-border px-3 py-2 font-medium">
                        Teléfono / celular
                      </th>
                      <th className="border-r border-border px-3 py-2 font-medium">
                        Email
                      </th>
                      <th className="border-r border-border px-3 py-2 font-medium">
                        Ingreso mensual
                      </th>
                      <th className="border-r border-border px-3 py-2 font-medium">
                        Fecha ingreso laboral
                      </th>
                      <th className="border-r border-border px-3 py-2 font-medium">
                        Antigüedad laboral meses
                      </th>
                      <th className="border-r border-border px-3 py-2 font-medium">
                        Estado civil
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {garantias.length > 0 ? (
                      garantias.map((garantia, index) => (
                        <tr className="border-t border-border" key={index}>
                          <td className="border-r border-border px-3 py-2">
                            <Checkbox
                              checked={selectedGarantiaIndexesSet.has(index)}
                              disabled={
                                !isEditing || !isGarantiasPartiallyEditable
                              }
                              onCheckedChange={(checked) =>
                                toggleGarantiaSelection(index, checked === true)
                              }
                            />
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {garantia.tipoRelacion ?? ""}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {garantia.tipoGarantia ?? ""}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {garantia.nombreCompleto ??
                              garantia.denominacion ??
                              ""}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {garantia.tipoDocumento && garantia.nroDocumento
                              ? `${garantia.tipoDocumento} ${garantia.nroDocumento}`
                              : (garantia.nroDocumento ??
                                garantia.tipoDocumento ??
                                "")}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {garantia.cuit ?? ""}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {garantia.telefono ?? garantia.celular ?? ""}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {garantia.email ?? ""}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {garantia.ingresoMensual === null ||
                            garantia.ingresoMensual === undefined
                              ? ""
                              : formatAmount(garantia.ingresoMensual)}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {garantia.fechaIngresoLaboral ?? ""}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {garantia.antiguedadLaboralMeses === null ||
                            garantia.antiguedadLaboralMeses === undefined
                              ? ""
                              : garantia.antiguedadLaboralMeses}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {garantia.estadoCivil ?? ""}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr className="border-t border-border">
                        <td className="px-3 py-3" colSpan={12}>
                          <TableEmptyState message="Sin garantías cargadas para mostrar." />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <AdjuntosSection
          adjuntos={adjuntos}
          canCreateAdjunto={canCreateAdjunto}
          canDeleteAdjunto={canDeleteAdjunto}
          canDownloadAdjunto={canDownloadAdjunto}
          deletingAdjuntoId={deletingAdjuntoId}
          downloadingAdjuntoId={downloadingAdjuntoId}
          editingAdjuntoId={editingAdjuntoId}
          embedded
          errorMessage={errorMessage}
          isLoading={isLoadingAdjuntos}
          isUploading={isUploadingAdjunto}
          onDeleteAdjunto={onDeleteAdjunto}
          onDownloadAdjunto={onDownloadAdjunto}
          onEditAdjunto={onEditAdjunto}
          onNewAdjuntosLote={onNewAdjuntosLote}
          onPreviewAdjunto={onPreviewAdjunto}
          previewingAdjuntoId={previewingAdjuntoId}
        />
      )}
    </DetailCard>
  );
}

function ErrorState({
  message,
  onBack,
}: {
  message: string;
  onBack: () => void;
}) {
  return (
    <article className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">
          Sistema Actual - Detalle de Solicitud
        </h1>
        <p className="mt-3 text-sm text-foreground-secondary sm:text-base">
          {message}
        </p>
        <div className="mt-6">
          <Button onClick={onBack} type="button" variant="outline">
            Volver a Precarga
          </Button>
        </div>
      </div>
    </article>
  );
}

export function SolicitudesActualDetallePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const solicitudId = params.id?.trim() ?? "";
  const originPath = getSolicitudCoreDetailOriginPath(
    searchParams.get("origen"),
  );
  const {
    data: solicitud,
    error: detailError,
    isLoading: isLoadingDetail,
    refetch: refetchDetail,
  } = useSolicitudCoreDetailQuery(solicitudId);
  const { data: currentUser } = useAuthSessionQuery();
  const canViewCalculadora = canAccessRiesgoTools(currentUser);
  const solicitudCapabilities = solicitud?.capabilities;
  const canChangeState = solicitudCapabilities?.canChangeState ?? false;
  const {
    data: adjuntos = [],
    error: adjuntosError,
    isLoading: isLoadingAdjuntos,
    refetch: refetchAdjuntos,
  } = useSolicitudCoreAdjuntosQuery(solicitudId);
  const {
    data: workflowTransitions = [],
    error: workflowTransitionsError,
    isLoading: isLoadingWorkflowTransitions,
    refetch: refetchWorkflowTransitions,
  } = useSolicitudCoreTransitionsQuery(solicitudId, {
    enabled: canChangeState,
  });
  const {
    data: workflowHistory = [],
    error: workflowHistoryError,
    isLoading: isLoadingWorkflowHistory,
  } = useSolicitudCoreHistoryQuery(solicitudId);
  const deleteSolicitudCoreAdjuntoMutation =
    useDeleteSolicitudCoreAdjuntoMutation(solicitudId);
  const downloadSolicitudCoreAdjuntoMutation =
    useDownloadSolicitudCoreAdjuntoMutation(solicitudId);
  const patchSolicitudCoreAdjuntoMutation =
    usePatchSolicitudCoreAdjuntoMutation(solicitudId);
  const patchSolicitudCoreMutation = usePatchSolicitudCoreMutation(solicitudId);
  const assignSolicitudToSelfMutation =
    useAssignSolicitudToSelfMutation(solicitudId);
  const assignSolicitudToUserMutation =
    useAssignSolicitudToUserMutation(solicitudId);
  const { data: assignableAgents = [], isLoading: isLoadingAssignableAgents } =
    useSolicitudAssignableAgentsQuery(solicitudId, {
      enabled: Boolean(
        solicitud && (solicitud.capabilities?.canChangeState ?? false),
      ),
    });
  const executeWorkflowTransitionMutation =
    useExecuteSolicitudCoreTransitionMutation(solicitudId, {
      isHistoryEnabled: true,
    });
  const createSocioMutation = useMutation({
    mutationFn: (payload: CreateSocioRequest) => createSocio(payload),
  });
  const createPrestamoLegacyMutation =
    useCreatePrestamoLegacyMutation(solicitudId);
  const [isEditing, setIsEditing] = useState(false);
  const [titularErrors, setTitularErrors] = useState<
    Partial<Record<keyof EditableSolicitudCoreValues["titular"], string>>
  >({});
  const [editableValues, setEditableValues] =
    useState<EditableSolicitudCoreValues | null>(null);
  const [deletingAdjuntoId, setDeletingAdjuntoId] = useState<string | null>(
    null,
  );
  const [downloadingAdjuntoId, setDownloadingAdjuntoId] = useState<
    string | null
  >(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewingAdjuntoId, setPreviewingAdjuntoId] = useState<string | null>(
    null,
  );
  const [editAdjuntoModal, setEditAdjuntoModal] =
    useState<SolicitudCoreAdjuntoResponse | null>(null);
  const [editingAdjuntoId] = useState<string | null>(null);
  const [isUploadingAdjunto, setIsUploadingAdjunto] = useState(false);
  const [isGarantiaModalOpen, setIsGarantiaModalOpen] = useState(false);
  const [isSimuladorOpen, setIsSimuladorOpen] = useState(false);
  const { data: lineasSimulador = [] } = useLineasPrestamoQuery();
  const [datosPersonalesTab, setDatosPersonalesTab] =
    useState<DatosPersonalesTab>("datosPersonales");
  const [solicitanteTab, setSolicitanteTab] =
    useState<SolicitanteTab>("solicitante");
  const [vistaTab, setVistaTab] =
    useState<SolicitudDetailVistaTab>("solicitud");
  const [editableGarantias, setEditableGarantias] = useState<
    CreateSolicitudCoreGarantiaRequest[] | null
  >(null);
  const [editingGarantiaIndex, setEditingGarantiaIndex] = useState<
    number | null
  >(null);
  const [garantiasDirty, setGarantiasDirty] = useState(false);
  const [selectedAssignmentValue, setSelectedAssignmentValue] =
    useState<string>("");
  const [selectedWorkflowTransition, setSelectedWorkflowTransition] =
    useState<WorkflowTransition | null>(null);
  const [isCreateSocioModalOpen, setIsCreateSocioModalOpen] = useState(false);

  useEffect(() => prefetchWhenIdle(loadSimuladorPrestamoModal), []);
  useEffect(() => {
    if (
      workflowHistoryError instanceof ApiError &&
      workflowHistoryError.status === 401
    ) {
      queryClient.setQueryData(authQueryKeys.session, null);
    }
  }, [queryClient, workflowHistoryError]);

  const shouldShowDatosLaborales = useMemo(
    () =>
      solicitud ? hasMeaningfulLaborData(solicitud.datosLaborales) : false,
    [solicitud],
  );
  const canEditSolicitud = solicitudCapabilities?.canEdit ?? false;
  const hasEditableSolicitudFields = hasAnySolicitudFieldEditable(
    solicitudCapabilities,
  );
  const canEditGarantias = hasAnyGarantiasFieldEditable(solicitudCapabilities);
  const canCreateGarantias = areAllGarantiasFieldsEditable(
    solicitudCapabilities,
  );
  const canUploadAdjuntos = solicitudCapabilities?.canUploadAdjuntos ?? false;
  const canDeleteAdjuntos = solicitudCapabilities?.canDeleteAdjuntos ?? false;
  const canDownloadAdjuntos =
    solicitudCapabilities?.canDownloadAdjuntos ?? false;
  const canManageCancelaciones =
    solicitudCapabilities?.canManageCancelaciones ?? false;
  const canManageAdjuntos = canUploadAdjuntos || canDeleteAdjuntos;
  const canEnterEditMode =
    canEditSolicitud && (hasEditableSolicitudFields || canManageAdjuntos);
  const isSolicitudFieldEditable = (fieldKey: string) =>
    isFieldEditable(
      solicitudCapabilities,
      fieldKey as Parameters<typeof isFieldEditable>[1],
    );
  const isGarantiaFieldEditable = (
    fieldKey: keyof CreateSolicitudCoreGarantiaRequest,
  ) =>
    isFieldEditable(
      solicitudCapabilities,
      `garantias.${fieldKey}` as (typeof GARANTIAS_FIELD_KEYS)[number],
    );
  const assignmentAgentOptions: StyledSelectOption[] = useMemo(() => {
    const options = assignableAgents.map((agent) => {
      const fullName = agent.fullName?.trim();
      const email = agent.email?.trim();
      const label = fullName || email || "Agente sin nombre";

      return {
        label,
        value: agent.id,
      };
    });

    if (solicitud?.assignedToUserId) {
      const alreadyIncluded = options.some(
        (option) => option.value === solicitud.assignedToUserId,
      );

      if (!alreadyIncluded) {
        options.unshift({
          label: resolveAssignmentLabel(solicitud),
          value: solicitud.assignedToUserId,
        });
      }
    }

    if (currentUser?.id) {
      const currentUserFullName =
        `${currentUser.firstName} ${currentUser.lastName}`.trim();
      const isCurrentUserSolicitudSeller =
        currentUserFullName.length > 0 &&
        currentUserFullName === (solicitud?.vendedorSolicitud?.trim() ?? "");
      const alreadyIncluded = options.some(
        (option) => option.value === currentUser.id,
      );

      if (!alreadyIncluded && !isCurrentUserSolicitudSeller) {
        options.unshift({
          label: "Asignarme a mi",
          value: currentUser.id,
        });
      }
    }

    return options;
  }, [
    assignableAgents,
    currentUser?.firstName,
    currentUser?.id,
    currentUser?.lastName,
    solicitud,
  ]);
  const workflowTransitionOptions: StyledSelectOption[] = useMemo(
    () =>
      workflowTransitions.map((transition) => ({
        disabled: transition.blockedReason !== null,
        disabledReason: transition.blockedReason ?? undefined,
        label: formatWorkflowTransitionOptionLabel(
          transition,
          solicitud?.estadoActual.code,
        ),
        value: transition.id,
      })),
    [solicitud?.estadoActual.code, workflowTransitions],
  );
  const ultimaNovedad = useMemo(() => {
    const latestHistoryWithComment = [...workflowHistory]
      .filter((item) => item.comentario?.trim())
      .sort((a, b) => {
        const dateA = new Date(a.changedAt).getTime();
        const dateB = new Date(b.changedAt).getTime();
        return dateB - dateA;
      })[0];

    const latestComment = latestHistoryWithComment?.comentario?.trim();
    return latestComment || PLACEHOLDER;
  }, [workflowHistory]);

  if (!solicitudId) {
    return (
      <ErrorState
        message="No se recibió un identificador válido para la solicitud."
        onBack={() => navigate(originPath)}
      />
    );
  }

  if (isLoadingDetail) {
    return (
      <SolicitudesContentLoader label="Cargando detalle de solicitud..." />
    );
  }

  if (detailError || !solicitud) {
    return (
      <ErrorState
        message="No se pudo cargar el detalle core de la solicitud."
        onBack={() => navigate(originPath)}
      />
    );
  }

  const resolvedSolicitud = solicitud;
  const currentValues =
    editableValues ?? mapSolicitudCoreToEditableValues(resolvedSolicitud);
  const currentGarantias =
    editableGarantias ??
    resolvedSolicitud.garantias.map(toEditableGarantiaRequest);
  const workflowTransitionErrorMessage =
    executeWorkflowTransitionMutation.error instanceof ApiError ||
    executeWorkflowTransitionMutation.error instanceof Error
      ? executeWorkflowTransitionMutation.error.message
      : null;
  const workflowTransitionSelectorErrorMessage =
    workflowTransitionsError instanceof ApiError ||
    workflowTransitionsError instanceof Error
      ? workflowTransitionsError.message
      : null;
  const workflowTransitionPlaceholder = !canChangeState
    ? "No disponible en este estado"
    : isLoadingWorkflowTransitions
      ? "Cargando acciones..."
      : workflowTransitionSelectorErrorMessage
        ? workflowTransitionSelectorErrorMessage
        : workflowTransitionOptions.length > 0
          ? "Enviar a..."
          : "Sin acciones disponibles";
  const workflowHistoryErrorMessage =
    workflowHistoryError instanceof ApiError &&
    workflowHistoryError.status === 403
      ? "No se pudo cargar el historial de la solicitud."
      : workflowHistoryError instanceof ApiError ||
          workflowHistoryError instanceof Error
        ? workflowHistoryError.message
        : null;
  const canManageAssignment = canManageSolicitudAssignment({
    canEditSolicitud,
    hasAssignmentOptions: assignmentAgentOptions.length > 0,
    isAssigningToSelf: assignSolicitudToSelfMutation.isPending,
    isAssigningToUser: assignSolicitudToUserMutation.isPending,
    isEditing,
    isLoadingAssignableAgents,
  });
  const assignmentLabel = resolveAssignmentLabel(resolvedSolicitud);
  const assignmentValueLabel = assignmentLabel;
  const readonlyAppearanceStyle = resolveReadonlyFieldStyle(
    resolvedSolicitud.appearance,
  );

  function handleStartEditing() {
    if (!canEnterEditMode) {
      return;
    }

    setEditableValues(mapSolicitudCoreToEditableValues(resolvedSolicitud));
    setEditableGarantias(null);
    setEditingGarantiaIndex(null);
    setGarantiasDirty(false);
    setIsGarantiaModalOpen(false);
    setSelectedAssignmentValue(resolvedSolicitud.assignedToUserId ?? "");
    setTitularErrors({});
    setIsEditing(true);
  }

  function handleCancelEditing() {
    setEditableValues(null);
    setEditableGarantias(null);
    setEditingGarantiaIndex(null);
    setTitularErrors({});
    setGarantiasDirty(false);
    setIsGarantiaModalOpen(false);
    setSelectedAssignmentValue(resolvedSolicitud.assignedToUserId ?? "");
    setIsEditing(false);
  }

  function updateSolicitudField(
    field: keyof EditableSolicitudCoreValues["solicitud"],
    value: string,
  ) {
    setEditableValues((current) =>
      current
        ? {
            ...current,
            solicitud: {
              ...current.solicitud,
              [field]: value,
            },
          }
        : current,
    );
  }

  function updateSolicitudBooleanField(
    field: keyof EditableSolicitudCoreValues["solicitud"],
    value: boolean,
  ) {
    setEditableValues((current) =>
      current
        ? {
            ...current,
            solicitud: {
              ...current.solicitud,
              [field]: value,
            },
          }
        : current,
    );
  }

  function updateTitularField(
    field: keyof EditableSolicitudCoreValues["titular"],
    value: string,
  ) {
    setEditableValues((current) =>
      current
        ? {
            ...current,
            titular: {
              ...current.titular,
              [field]: value,
            },
          }
        : current,
    );
  }

  function updateTitularBooleanField(value: boolean) {
    setEditableValues((current) =>
      current
        ? {
            ...current,
            titular: {
              ...current.titular,
              personaExpuestaPoliticamente: value,
            },
          }
        : current,
    );
  }

  function updateConyugeField(
    field: keyof NonNullable<EditableSolicitudCoreValues["conyuge"]>,
    value: string,
  ) {
    setEditableValues((current) => {
      if (!current?.conyuge) {
        return current;
      }

      return {
        ...current,
        conyuge: {
          ...current.conyuge,
          [field]: value,
        },
      };
    });
  }

  function updateDatosLaboralesField(
    field: keyof EditableSolicitudCoreValues["datosLaborales"],
    value: string,
  ) {
    setEditableValues((current) =>
      current
        ? {
            ...current,
            datosLaborales: {
              ...current.datosLaborales,
              [field]: value,
              ...(field === "fechaIngresoLaboral"
                ? {
                    antiguedadLaboralMeses: calculateLaborMonths(value),
                  }
                : {}),
            },
          }
        : current,
    );
  }

  function handleGarantiaEdit(index: number) {
    if (!isEditing) {
      return;
    }

    setEditingGarantiaIndex(index);
    setIsGarantiaModalOpen(true);
  }

  function handleGarantiaCreate() {
    if (!isEditing) {
      return;
    }

    setEditingGarantiaIndex(null);
    setIsGarantiaModalOpen(true);
  }

  function handleGarantiaModalOpenChange(nextOpen: boolean) {
    setIsGarantiaModalOpen(nextOpen);

    if (!nextOpen) {
      setEditingGarantiaIndex(null);
    }
  }

  function handleGarantiaSave(garantia: CreateSolicitudCoreGarantiaRequest) {
    setEditableGarantias((current) => {
      const baseGarantias = current ?? [...currentGarantias];
      const nextGarantias = [...baseGarantias];
      if (editingGarantiaIndex === null) {
        nextGarantias.push(garantia);
      } else {
        nextGarantias[editingGarantiaIndex] = garantia;
      }
      return nextGarantias;
    });
    setGarantiasDirty(true);
    setEditingGarantiaIndex(null);
    setIsGarantiaModalOpen(false);
  }

  async function handleSaveChanges() {
    toast.dismiss(EDIT_SOLICITUD_ERROR_TOAST_ID);
    toast.dismiss(EDIT_SOLICITUD_SUCCESS_TOAST_ID);

    const payload = mapEditableValuesToPatchSolicitudCoreRequest(
      currentValues,
      resolvedSolicitud,
    );

    if (garantiasDirty && editableGarantias) {
      payload.garantias = editableGarantias;
    }

    const currentAssignedTo = resolvedSolicitud.assignedToUserId ?? "";
    const hasAssignmentChange = selectedAssignmentValue !== currentAssignedTo;

    if (Object.keys(payload).length === 0 && !hasAssignmentChange) {
      setEditableValues(null);
      setEditableGarantias(null);
      setEditingGarantiaIndex(null);
      setGarantiasDirty(false);
      setIsGarantiaModalOpen(false);
      setSelectedAssignmentValue("");
      setTitularErrors({});
      setIsEditing(false);
      return;
    }

    try {
      if (Object.keys(payload).length > 0) {
        await patchSolicitudCoreMutation.mutateAsync(payload);
      }
      if (hasAssignmentChange) {
        await handleAssignToSelectedAgent();
      }
      toast.success("Solicitud actualizada correctamente.", {
        duration: 3500,
        icon: <CircleCheckBig className="size-5" />,
        id: EDIT_SOLICITUD_SUCCESS_TOAST_ID,
      });
      setEditableValues(null);
      setEditableGarantias(null);
      setEditingGarantiaIndex(null);
      setGarantiasDirty(false);
      setIsGarantiaModalOpen(false);
      setSelectedAssignmentValue("");
      setTitularErrors({});
      setIsEditing(false);
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo actualizar la solicitud.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: EDIT_SOLICITUD_ERROR_TOAST_ID,
      });
    }
  }

  async function handleAddAdjuntosLote(items: AdjuntoLoteItem[]) {
    toast.dismiss(UPLOAD_ADJUNTO_ERROR_TOAST_ID);
    toast.dismiss(UPLOAD_ADJUNTO_SUCCESS_TOAST_ID);
    setIsUploadingAdjunto(true);

    try {
      const createdAdjuntos = await uploadSolicitudCoreAdjuntosLote(
        resolvedSolicitud.id,
        items,
      );

      await queryClient.invalidateQueries({
        queryKey: solicitudesCoreQueryKeys.adjuntos(resolvedSolicitud.id),
      });

      toast.success(
        createdAdjuntos.length === 1
          ? "Adjunto cargado."
          : `${createdAdjuntos.length} adjuntos cargados.`,
        {
          duration: 3500,
          icon: <CircleCheckBig className="size-5" />,
          id: UPLOAD_ADJUNTO_SUCCESS_TOAST_ID,
        },
      );

      return true;
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudieron cargar los adjuntos.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: UPLOAD_ADJUNTO_ERROR_TOAST_ID,
      });

      return false;
    } finally {
      setIsUploadingAdjunto(false);
    }
  }

  async function handleDownloadAdjunto(adjunto: SolicitudCoreAdjuntoResponse) {
    toast.dismiss(DOWNLOAD_ADJUNTO_ERROR_TOAST_ID);
    const loadingStartedAt = Date.now();
    setDownloadingAdjuntoId(adjunto.id);

    try {
      const response = await downloadSolicitudCoreAdjuntoMutation.mutateAsync(
        adjunto.id,
      );
      const fileName =
        response.fileName ??
        adjunto.archivoNombre ??
        `adjunto-${adjunto.id.slice(0, 8)}`;
      const objectUrl = window.URL.createObjectURL(response.blob);
      const anchor = document.createElement("a");

      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo descargar el adjunto.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: DOWNLOAD_ADJUNTO_ERROR_TOAST_ID,
      });
    } finally {
      const elapsedMs = Date.now() - loadingStartedAt;
      const remainingMs = DOWNLOAD_BUTTON_MIN_LOADING_MS - elapsedMs;

      if (remainingMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingMs));
      }

      setDownloadingAdjuntoId(null);
    }
  }

  async function handleDeleteAdjunto(adjunto: SolicitudCoreAdjuntoResponse) {
    toast.dismiss(DELETE_ADJUNTO_ERROR_TOAST_ID);
    toast.dismiss(DELETE_ADJUNTO_SUCCESS_TOAST_ID);
    setDeletingAdjuntoId(adjunto.id);

    try {
      await deleteSolicitudCoreAdjuntoMutation.mutateAsync(adjunto.id);
      toast.success("Adjunto eliminado correctamente.", {
        duration: 3500,
        icon: <CircleCheckBig className="size-5" />,
        id: DELETE_ADJUNTO_SUCCESS_TOAST_ID,
      });
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo eliminar el adjunto.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: DELETE_ADJUNTO_ERROR_TOAST_ID,
      });
    } finally {
      setDeletingAdjuntoId(null);
    }
  }

  async function handleCreateSocio(
    payload: CreateSocioRequest | UpdateSocioRequest,
  ) {
    await createSocioMutation.mutateAsync(payload as CreateSocioRequest);

    await queryClient.invalidateQueries({
      queryKey: solicitudesCoreQueryKeys.transitions(solicitudId),
    });
    setIsCreateSocioModalOpen(false);
    toast.success("Socio creado correctamente.", {
      duration: 3500,
      icon: <CircleCheckBig className="size-5" />,
      id: CREATE_SOCIO_SUCCESS_TOAST_ID,
    });
  }

  async function handleCreatePrestamoLegacy() {
    toast.dismiss(CREATE_PRESTAMO_LEGACY_ERROR_TOAST_ID);
    toast.dismiss(CREATE_PRESTAMO_LEGACY_SUCCESS_TOAST_ID);

    try {
      await createPrestamoLegacyMutation.mutateAsync();
      toast.success("Préstamo creado en el legado correctamente.", {
        duration: 3500,
        icon: <CircleCheckBig className="size-5" />,
        id: CREATE_PRESTAMO_LEGACY_SUCCESS_TOAST_ID,
      });
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo crear el préstamo en el legado.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: CREATE_PRESTAMO_LEGACY_ERROR_TOAST_ID,
      });
    }
  }

  async function handlePreviewAdjunto(adjunto: SolicitudCoreAdjuntoResponse) {
    toast.dismiss(PREVIEW_ADJUNTO_ERROR_TOAST_ID);
    setPreviewingAdjuntoId(adjunto.id);

    try {
      const response = await downloadSolicitudCoreAdjuntoMutation.mutateAsync(
        adjunto.id,
      );
      const fileName =
        response.fileName ??
        adjunto.archivoNombre ??
        `adjunto-${adjunto.id.slice(0, 8)}`;
      const file = new File([response.blob], fileName, {
        type:
          response.contentType ??
          response.blob.type ??
          "application/octet-stream",
      });
      setPreviewFile(file);
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo descargar el adjunto para previsualizar.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: PREVIEW_ADJUNTO_ERROR_TOAST_ID,
      });
    } finally {
      setPreviewingAdjuntoId(null);
    }
  }

  function handleOpenEditAdjunto(adjunto: SolicitudCoreAdjuntoResponse) {
    setEditAdjuntoModal(adjunto);
  }

  async function handleSaveEditAdjunto(
    payload: { file: File | null } & Omit<
      UploadSolicitudCoreAdjuntoRequest,
      "file"
    >,
  ) {
    if (!editAdjuntoModal) return false;

    toast.dismiss(REPLACE_ADJUNTO_ERROR_TOAST_ID);
    toast.dismiss(REPLACE_ADJUNTO_SUCCESS_TOAST_ID);
    setIsUploadingAdjunto(true);

    try {
      if (payload.file) {
        const createdAdjunto = await uploadSolicitudCoreAdjunto(
          resolvedSolicitud.id,
          { ...payload, file: payload.file },
        );

        try {
          await deleteSolicitudCoreAdjuntoMutation.mutateAsync(
            editAdjuntoModal.id,
          );
        } catch {
          // swallow: new version uploaded successfully; old one stays
        }

        await queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.adjuntos(resolvedSolicitud.id),
        });

        toast.success(
          `Adjunto actualizado: ${createdAdjunto.archivoNombre ?? createdAdjunto.id}`,
          {
            duration: 3500,
            icon: <CircleCheckBig className="size-5" />,
            id: REPLACE_ADJUNTO_SUCCESS_TOAST_ID,
          },
        );
      } else {
        await patchSolicitudCoreAdjuntoMutation.mutateAsync({
          adjuntoId: editAdjuntoModal.id,
          adicional: payload.adicional,
          comentario: payload.comentario,
          descripcion: payload.descripcion,
          nroDocumento: payload.nroDocumento,
          restringido: payload.restringido,
          tipoAdjunto: payload.tipoAdjunto,
        });

        toast.success("Adjunto actualizado.", {
          duration: 3500,
          icon: <CircleCheckBig className="size-5" />,
          id: REPLACE_ADJUNTO_SUCCESS_TOAST_ID,
        });
      }

      setEditAdjuntoModal(null);
      return true;
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo actualizar el adjunto.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: REPLACE_ADJUNTO_ERROR_TOAST_ID,
      });
      return false;
    } finally {
      setIsUploadingAdjunto(false);
    }
  }

  function resolveWorkflowTransitionErrorMessage(error: unknown) {
    if (
      error instanceof ApiError &&
      error.code === "WorkflowExecutionPlanStateConflictError"
    ) {
      return "La solicitud cambio de estado. Se recargaron los datos.";
    }

    if (error instanceof ApiError && error.status === 403) {
      return "No tenés permisos para ejecutar esta acción.";
    }

    if (error instanceof ApiError && error.status === 401) {
      return "La sesión expiró. Inicia sesión nuevamente.";
    }

    if (error instanceof ApiError || error instanceof Error) {
      return error.message;
    }

    return "No se pudo ejecutar la acción.";
  }

  async function handleExecuteWorkflowTransition(
    payload: ExecuteWorkflowTransitionRequest,
  ) {
    toast.dismiss(WORKFLOW_TRANSITION_ERROR_TOAST_ID);
    toast.dismiss(WORKFLOW_TRANSITION_SUCCESS_TOAST_ID);

    try {
      await executeWorkflowTransitionMutation.mutateAsync(payload);
      toast.success("Acción ejecutada correctamente.", {
        duration: 3500,
        icon: <CircleCheckBig className="size-5" />,
        id: WORKFLOW_TRANSITION_SUCCESS_TOAST_ID,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        queryClient.setQueryData(authQueryKeys.session, null);
      }

      toast.error(resolveWorkflowTransitionErrorMessage(error), {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: WORKFLOW_TRANSITION_ERROR_TOAST_ID,
      });

      throw error;
    }
  }

  async function handleAssignToSelectedAgent() {
    if (!selectedAssignmentValue) {
      toast.error("Selecciona un agente para asignar la solicitud.", {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: ASSIGN_TO_USER_ERROR_TOAST_ID,
      });
      return;
    }

    toast.dismiss(ASSIGN_TO_USER_ERROR_TOAST_ID);
    toast.dismiss(ASSIGN_TO_USER_SUCCESS_TOAST_ID);

    try {
      if (currentUser?.id && selectedAssignmentValue === currentUser.id) {
        await assignSolicitudToSelfMutation.mutateAsync();
      } else {
        await assignSolicitudToUserMutation.mutateAsync(
          selectedAssignmentValue,
        );
      }
      setSelectedAssignmentValue("");
      toast.success("Solicitud asignada correctamente.", {
        duration: 3500,
        icon: <CircleCheckBig className="size-5" />,
        id: ASSIGN_TO_USER_SUCCESS_TOAST_ID,
      });
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo asignar la solicitud.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: ASSIGN_TO_USER_ERROR_TOAST_ID,
      });
    }
  }

  function handleSaveToolbarAction() {
    if (isEditing) {
      void handleSaveChanges();
      return;
    }

    if (canEnterEditMode) {
      handleStartEditing();
    }
  }

  function handleRefresh() {
    void Promise.all([
      refetchDetail(),
      refetchAdjuntos(),
      refetchWorkflowTransitions(),
    ]);
  }

  function handleWorkflowTransitionChange(transitionId: string) {
    setTitularErrors({});

    if (!transitionId) {
      setSelectedWorkflowTransition(null);
      return;
    }

    const transition =
      workflowTransitions.find((candidate) => candidate.id === transitionId) ??
      null;

    executeWorkflowTransitionMutation.reset();
    setSelectedWorkflowTransition(transition);
  }

  function handleValidateWorkflowTransition(
    payload: ExecuteWorkflowTransitionRequest,
  ) {
    if (payload.actionCode !== CONFIRMAR_ACTION_CODE) {
      setTitularErrors({});
      return null;
    }

    const { errors, missingLabels } = validateTitularRequiredForConfirmar(
      currentValues.titular,
    );

    if (missingLabels.length === 0) {
      setTitularErrors({});
      return null;
    }

    setTitularErrors(errors);

    return `Debe completar los siguientes datos del titular antes de confirmar: ${missingLabels.join(", ")}.`;
  }

  async function handleConfirmWorkflowTransition(
    payload: ExecuteWorkflowTransitionRequest,
  ) {
    await handleExecuteWorkflowTransition(payload);
    setSelectedWorkflowTransition(null);
  }

  return (
    <article
      className={`flex flex-col rounded-md border border-border bg-surface shadow-sm ${
        canViewCalculadora ? "h-full" : "min-h-full"
      }`}
    >
      <header className="border-b border-border bg-surface px-3 py-2.5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5 justify-self-start">
            <Button
              className="text-foreground-secondary"
              onClick={() => navigate(originPath)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <FileText className="size-4 shrink-0 text-primary" />
            <h1 className="truncate text-[2rem] leading-none font-semibold text-foreground">
              Detalle de Solicitud
            </h1>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 justify-self-center">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground-muted">
                Solicitud ID
              </span>
              <IdChip value={resolvedSolicitud.id} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground-muted">
                Préstamo
              </span>
              {resolvedSolicitud.legacyOid ? (
                <IdChip value={resolvedSolicitud.legacyOid} variant="accent" />
              ) : (
                <Badge icon={<Clock className="size-3" />} variant="neutral">
                  Sin generar
                </Badge>
              )}
            </div>
          </div>
          <Badge
            className="px-4 py-1.5 text-sm font-semibold justify-self-end"
            dot
            variant={getEstadoBadgeVariant(resolvedSolicitud.estadoActual.code)}
          >
            {formatText(
              resolvedSolicitud.estadoActual.code ||
                resolvedSolicitud.estadoActual.name,
            )}
          </Badge>
        </div>
      </header>

      <SolicitudDetailToolbar
        canEdit={canEnterEditMode}
        isCreatePrestamoLegacyPending={createPrestamoLegacyMutation.isPending}
        isEditing={isEditing}
        isSaveDisabled={
          patchSolicitudCoreMutation.isPending ||
          (isEditing ? !hasEditableSolicitudFields : !canEnterEditMode)
        }
        isPrestamoLegacyGenerado={Boolean(resolvedSolicitud.legacyOid)}
        onCreatePrestamoLegacy={
          canCreateSocio(currentUser)
            ? () => void handleCreatePrestamoLegacy()
            : undefined
        }
        onCreateSocio={
          canCreateSocio(currentUser)
            ? () => setIsCreateSocioModalOpen(true)
            : undefined
        }
        onOpenSimulador={() => setIsSimuladorOpen(true)}
        onPreloadSimulador={loadSimuladorPrestamoModal}
        onRefresh={handleRefresh}
        onSave={handleSaveToolbarAction}
        onStartEdit={handleStartEditing}
        transitionControl={
          <StyledSelect
            className="!h-7 !min-h-7 rounded-[min(var(--radius-md),12px)] !px-2.5 !py-0 text-[0.8rem] leading-none"
            disabled={
              !canChangeState ||
              isLoadingWorkflowTransitions ||
              workflowTransitionSelectorErrorMessage !== null ||
              executeWorkflowTransitionMutation.isPending ||
              workflowTransitionOptions.length === 0
            }
            onChange={handleWorkflowTransitionChange}
            options={workflowTransitionOptions}
            placeholder={workflowTransitionPlaceholder}
            value={selectedWorkflowTransition?.id ?? ""}
          />
        }
      />

      <SolicitudWorkflowActionDialog
        errorMessage={workflowTransitionErrorMessage}
        isSubmitting={executeWorkflowTransitionMutation.isPending}
        onConfirm={handleConfirmWorkflowTransition}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedWorkflowTransition(null);
          }
        }}
        open={selectedWorkflowTransition !== null}
        transition={selectedWorkflowTransition}
        validate={handleValidateWorkflowTransition}
      />

      {canViewCalculadora ? (
        <div className="border-b border-border bg-surface px-3 md:px-4">
          <div className="flex gap-4">
            {SOLICITUD_DETAIL_VISTA_TABS.map((tab) => {
              const isActive = tab.value === vistaTab;

              return (
                <button
                  className={`border-b-2 px-0 py-2 text-sm font-medium transition ${
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-foreground-secondary hover:text-foreground"
                  }`}
                  key={tab.value}
                  onClick={() => setVistaTab(tab.value)}
                  type="button"
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {!canViewCalculadora || vistaTab === "solicitud" ? (
        <div
          className={`space-y-3 p-3 pb-8 md:p-4 md:pb-10 ${
            canViewCalculadora ? "min-h-0 flex-1 overflow-y-auto" : ""
          }`}
        >
          {isEditing ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                disabled={patchSolicitudCoreMutation.isPending}
                onClick={handleCancelEditing}
                type="button"
                variant="outline"
              >
                Cancelar
              </Button>
              <Button
                disabled={patchSolicitudCoreMutation.isPending}
                onClick={() => void handleSaveChanges()}
                type="button"
              >
                <Pencil className="size-4" />
                Guardar cambios
              </Button>
            </div>
          ) : null}
          <SolicitudSection
            assignmentOptions={assignmentAgentOptions}
            assignmentValue={selectedAssignmentValue}
            assignmentValueLabel={assignmentValueLabel}
            isFieldEditableByKey={isSolicitudFieldEditable}
            isEditing={isEditing}
            isExecutiveAssignmentDisabled={!canManageAssignment}
            onAssignmentChange={setSelectedAssignmentValue}
            onBooleanChange={updateSolicitudBooleanField}
            onChange={updateSolicitudField}
            readonlyAppearanceStyle={readonlyAppearanceStyle}
            solicitud={resolvedSolicitud}
            ultimaNovedad={ultimaNovedad}
            values={currentValues.solicitud}
          />
          <SolicitanteSection
            activeTab={solicitanteTab}
            adjuntos={adjuntos}
            canCreateAdicional={isEditing && canUploadAdjuntos}
            canCreateAdjunto={isEditing && canUploadAdjuntos}
            canDeleteAdjunto={isEditing && canDeleteAdjuntos}
            canDownloadAdjunto={canDownloadAdjuntos}
            canManageCancelaciones={canManageCancelaciones}
            datosLaborales={resolvedSolicitud.datosLaborales}
            datosPersonalesTab={datosPersonalesTab}
            deletingAdjuntoId={deletingAdjuntoId}
            downloadingAdjuntoId={downloadingAdjuntoId}
            errorMessage={
              adjuntosError
                ? "No se pudieron cargar los adjuntos de la solicitud."
                : undefined
            }
            isFieldEditableByKey={isSolicitudFieldEditable}
            isGarantiasFullyEditable={canCreateGarantias}
            isGarantiasPartiallyEditable={canEditGarantias}
            isEditing={isEditing}
            isLoadingAdjuntos={isLoadingAdjuntos}
            isUploadingAdjunto={isUploadingAdjunto}
            onConyugeChange={updateConyugeField}
            onDatosLaboralesChange={updateDatosLaboralesField}
            editingAdjuntoId={editingAdjuntoId}
            onDatosPersonalesTabChange={setDatosPersonalesTab}
            onDeleteAdjunto={handleDeleteAdjunto}
            onDownloadAdjunto={handleDownloadAdjunto}
            onEditAdjunto={handleOpenEditAdjunto}
            onGarantiaCreate={handleGarantiaCreate}
            onNewAdjuntosLote={handleAddAdjuntosLote}
            onPreviewAdjunto={handlePreviewAdjunto}
            previewingAdjuntoId={previewingAdjuntoId}
            onGarantiaEdit={handleGarantiaEdit}
            onTabChange={setSolicitanteTab}
            onTitularBooleanChange={updateTitularBooleanField}
            onTitularChange={updateTitularField}
            readonlyAppearanceStyle={readonlyAppearanceStyle}
            shouldShowDatosLaborales={shouldShowDatosLaborales}
            solicitudId={solicitudId}
            garantias={currentGarantias}
            titularConyuge={resolvedSolicitud.conyuge}
            titularConyugeValues={currentValues.conyuge}
            titularDatosLaboralesValues={currentValues.datosLaborales}
            titular={resolvedSolicitud.titular}
            titularErrors={titularErrors}
            titularValues={currentValues.titular}
          />
          <SolicitudWorkflowHistorySection
            errorMessage={workflowHistoryErrorMessage}
            history={workflowHistory}
            isLoading={isLoadingWorkflowHistory}
          />
        </div>
      ) : null}

      {canViewCalculadora && vistaTab === "evaluacion" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Suspense
            fallback={
              <SolicitudesContentLoader label="Cargando calculadora..." />
            }
          >
            <CalculadoraMutualSheet
              className="flex-1"
              source={{ kind: "embedded", solicitudId }}
            />
          </Suspense>
        </div>
      ) : null}

      <NuevaGarantiaModal
        defaultValues={
          editingGarantiaIndex === null
            ? undefined
            : currentGarantias[editingGarantiaIndex]
        }
        isFieldEditable={isGarantiaFieldEditable}
        onOpenChange={handleGarantiaModalOpenChange}
        onSave={handleGarantiaSave}
        open={isGarantiaModalOpen}
        saveLabel={
          editingGarantiaIndex === null
            ? "Agregar adicional"
            : "Guardar cambios"
        }
        title={
          editingGarantiaIndex === null
            ? "Agregar adicional"
            : "Editar garantía"
        }
      />
      {isSimuladorOpen ? (
        <Suspense
          fallback={<ModalLoadingOverlay label="Cargando simulador..." />}
        >
          <SimuladorPrestamoModal
            defaultLineaOid={
              resolvedSolicitud.lineaPrestamoLegacyOid ?? undefined
            }
            lineas={lineasSimulador}
            onApply={(valores) => {
              setEditableValues((current) =>
                current
                  ? {
                      ...current,
                      solicitud: {
                        ...current.solicitud,
                        cuotaResultante: valores.cuotaResultante,
                        cuotas: valores.cuotas,
                        fechaPrimerVencimiento: valores.fechaPrimerVencimiento,
                        montoAFinanciar: valores.montoAFinanciar,
                      },
                    }
                  : current,
              );
              setIsSimuladorOpen(false);
            }}
            onOpenChange={setIsSimuladorOpen}
            open={isSimuladorOpen}
          />
        </Suspense>
      ) : null}
      <AdjuntoPreviewModal
        file={previewFile}
        onOpenChange={(open) => {
          if (!open) setPreviewFile(null);
        }}
        open={previewFile !== null}
      />
      <NuevaAdjuntoModal
        initialValues={
          editAdjuntoModal
            ? {
                adicional: editAdjuntoModal.adicional ?? undefined,
                comentario: editAdjuntoModal.comentario ?? undefined,
                descripcion: editAdjuntoModal.descripcion ?? undefined,
                existingFileName: editAdjuntoModal.archivoNombre ?? undefined,
                nroDocumento: editAdjuntoModal.nroDocumento ?? undefined,
                restringido: editAdjuntoModal.restringido,
                tipoAdjunto: editAdjuntoModal.tipoAdjunto ?? undefined,
              }
            : undefined
        }
        isSaving={isUploadingAdjunto}
        onOpenChange={(open) => {
          if (!open) setEditAdjuntoModal(null);
        }}
        onSaveEdit={handleSaveEditAdjunto}
        open={editAdjuntoModal !== null}
      />
      <SocioFormDialog
        initialValues={buildSocioPrefillFromTitular(resolvedSolicitud.titular)}
        isSaving={createSocioMutation.isPending}
        onOpenChange={setIsCreateSocioModalOpen}
        onSubmit={handleCreateSocio}
        open={isCreateSocioModalOpen}
        socio={null}
      />
    </article>
  );
}
