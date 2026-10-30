import { AdministrativeStateControl } from "../components/administrative-state-control";
import { EvaluacionRecibosView } from "../components/evaluacion-recibos-view";
import { getRecibosDeSolicitud } from "../utils/recibos-de-solicitud";
import {
  ajustarMontoTexto,
  ajustarCuotasTexto,
} from "@/modules/solicitudes-shared/utils/maximos-linea";
import { useCuotaCalculada } from "@/modules/solicitudes-core/hooks/use-cuota-calculada";
import { LinkFirmaDigital } from "../components/link-firma-digital";
import { SolicitudesDelTitularSection } from "../components/solicitudes-del-titular-section";
import { clasificarEstadoPrestamo } from "../utils/prestamo-estado";
import {
  CabeceraSolicitud,
  CabeceraSolicitudEnBarra,
  SituacionDelSocio,
} from "@/modules/solicitudes-core/components/cabecera-solicitud";
import {
  COLUMNAS_TITULAR,
  DetalleLectura,
  DOS_COLUMNAS,
} from "@/modules/solicitudes-core/components/detalle-lectura";
import { datosRapidosApi } from "@/modules/solicitudes-core/services/datos-rapidos-api";
import { socioIndicator } from "@/modules/solicitudes-core/utils/datos-rapidos-state";
import {
  Check,
  CircleAlert,
  CircleCheckBig,
  Download,
  Eye,
  Pencil,
  Plus,
  Send,
  Trash2,
  Undo2,
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
import {
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import {
  getMontoSuperaTopeError,
  getTopeMontoRiesgo,
} from "@/modules/solicitudes-core/utils/tope-monto-riesgo";
import { authQueryKeys } from "@/modules/auth/hooks/use-auth-session";
import {
  canViewPrestamosDelSocio,
  canAccessRiesgoTools,
  canCreateSocio,
  isVendedor,
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
import { ExternalPaymentControl } from "@/modules/solicitudes-core/components/external-payment-control";
import { SolicitudWorkflowHistorySection } from "@/modules/solicitudes-core/components/solicitud-workflow-history-section";
import { DocumentReviewPanel } from "@/modules/solicitudes-core/components/document-review-panel";
import { LinkedLoanStatusBanner } from "../components/linked-loan-status-banner";
import { ControlledLoanReplacementControl } from "../components/controlled-loan-replacement-control";
import { useLinkedLoanStatus } from "../services/linked-loan-status-api";
import { useDocumentReview } from "@/modules/solicitudes-core/services/document-review-api";
import {
  RequiredMark,
  Section,
  SectionTabs,
  StyledSelect,
  legacyFieldClassName,
} from "@/modules/solicitudes-editor/components/fields/base";
import {
  ESTADO_CIVIL_OPTIONS,
  normalizarSexo,
  SEXO_OPTIONS,
  sexoLegible,
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
import { CredixsaInformeSection } from "@/modules/solicitudes-core/components/credixsa-informe-section";
import { GenerarPrestamoDialog } from "@/modules/solicitudes-core/components/generar-prestamo-dialog";
import { PrestamoDelSocioDialog } from "@/modules/solicitudes-core/components/prestamo-del-socio-dialog";
import { RefinanciacionSection } from "@/modules/solicitudes-core/components/refinanciacion-section";
import { usePrestamoDelSocioQuery } from "@/modules/solicitudes-core/hooks/use-prestamo-del-socio-query";
import { usePrestamosDelSocioQuery } from "@/modules/solicitudes-core/hooks/use-prestamos-del-socio-query";
import { formatLegacyDate } from "@/modules/solicitudes-core/utils/legacy-date-format";
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
  type ConvenioSocioRequest,
  uploadSolicitudCoreAdjunto,
  uploadSolicitudCoreAdjuntosLote,
} from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";
import { SolicitudesContentLoader } from "@/modules/solicitudes-shared/components/solicitudes-content-loader";
import { loadSimuladorPrestamoModal } from "@/modules/solicitudes-shared/utils/load-simulador-prestamo-modal";
import { getCuotasFueraDeLineaError } from "@/modules/solicitudes-shared/utils/cuotas-linea";
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
import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";
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
import { LocalidadSelect } from "@/modules/socios/components/localidad-select";
import { SocioFormDialog } from "@/modules/socios/components/socio-form-dialog";
import { createSocio } from "@/modules/socios/services/socios-api";
import { useCreatePrestamoLegacyMutation } from "@/modules/solicitudes-core/hooks/use-create-prestamo-legacy-mutation";
import type {
  CreateSocioRequest,
  UpdateSocioRequest,
} from "@/modules/socios/types";
import { StaticMoneyInput } from "@/shared/components/forms/money-input-field";
import {
  formatMoneyAmount,
  formatDecimalMoneyValue,
  formatNullableAmount,
  parseMoneyValue,
} from "@/shared/utils/money-format";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
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
import { TABLA } from "@/modules/solicitudes-core/utils/tabla-detalle";
import { esCuitValido } from "@/shared/utils/cuit";
import { nombreEstado } from "@/modules/solicitudes-shared/utils/nombre-estado";

const EDIT_SOLICITUD_ERROR_TOAST_ID = "edit-solicitud-core-error";
const EDIT_SOLICITUD_SUCCESS_TOAST_ID = "edit-solicitud-core-success";
// Id propio a proposito: sonner publica el dismiss en el frame siguiente, y
// handleSaveChanges hace dismiss de EDIT_SOLICITUD_ERROR_TOAST_ID justo antes
// de validar. Con ese id, el aviso se mostraba y se borraba en el acto.
const EDIT_SOLICITUD_CUOTAS_ERROR_TOAST_ID = "edit-solicitud-core-cuotas-error";
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
  | "cbu"
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
  { key: "cbu", label: "CBU" },
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

type SolicitanteTab =
  | "adjuntos"
  | "cancelaciones"
  | "prestamos"
  | "refinanciacion"
  | "solicitante"
  | "solicitudes";
type SolicitanteContentTab =
  | DatosPersonalesTab
  | "adjuntos"
  | "cancelaciones"
  | "prestamos"
  | "refinanciacion"
  | "solicitudes";

const SOLICITANTE_CONTENT_TABS: TabItem<SolicitanteContentTab>[] = [
  { label: "Datos Personales", value: "datosPersonales" },
  { label: "Cancelaciones", value: "cancelaciones" },
  { label: "Adjuntos", value: "adjuntos" },
];

// Orden de las pestanas de "Más información" (lectura).
const ORDEN_MAS_INFORMACION: SolicitanteContentTab[] = [
  "adjuntos",
  "prestamos",
  "solicitudes",
  "refinanciacion",
  "cancelaciones",
];

// Vendedores no ve esta pestaña: es informacion para analizar, no para cargar.
// El backend hace el mismo chequeo -- esto solo evita mostrar algo que daria
// 403 al abrirlo.
const PRESTAMOS_TAB: TabItem<SolicitanteContentTab> = {
  label: "Préstamos",
  value: "prestamos",
};

// Mismo criterio que Prestamos: elegir cuotas a refinanciar requiere ver los
// prestamos del socio. Va al lado de Cancelaciones porque las dos cambian el
// en mano del prestamo nuevo.
const REFINANCIACION_TAB: TabItem<SolicitanteContentTab> = {
  label: "Refinanciación",
  value: "refinanciacion",
};

const CANCELACIONES_TABLE_COLUMNS = [
  "Cuenta a debitar",
  "CBU",
  "Monto",
  "Notas",
  "Socio",
  "Cuenta bancaria",
] as const;

const PRESTAMOS_TABLE_COLUMNS = [
  "Nº de préstamo",
  "Línea",
  "Fecha",
  "Total cuotas",
  "Monto a desembolsar",
  "Saldo",
  "Vencimiento",
] as const;

type PrestamosDelSocioSectionProps = {
  isActive: boolean;
  solicitudId: string;
};

// Los prestamos que el socio ya tiene con la mutual. Salen de Vimarx en vivo,
// no de nuestra base, y solo se piden cuando la pestaña esta abierta.
function PrestamosDelSocioSection({
  isActive,
  solicitudId,
}: PrestamosDelSocioSectionProps) {
  const { data, error, isLoading } = usePrestamosDelSocioQuery(
    solicitudId,
    isActive,
  );
  const prestamos = data?.prestamos ?? [];
  const [filtro, setFiltro] = useState<
    "activos" | "otros" | "desconocidos" | "todos"
  >("activos");
  const activos = prestamos.filter(
    (prestamo) => clasificarEstadoPrestamo(prestamo) === "activos",
  );
  const otros = prestamos.filter(
    (prestamo) => clasificarEstadoPrestamo(prestamo) === "otros",
  );
  const desconocidos = prestamos.filter(
    (prestamo) => clasificarEstadoPrestamo(prestamo) === "desconocidos",
  );
  const prestamosVisibles =
    filtro === "activos"
      ? activos
      : filtro === "otros"
        ? otros
        : filtro === "desconocidos"
          ? desconocidos
          : [...activos, ...otros, ...desconocidos];
  // Id en Vimarx del prestamo abierto en el modal; null con el modal cerrado.
  const [prestamoAbiertoId, setPrestamoAbiertoId] = useState<string | null>(
    null,
  );

  return (
    <div className="space-y-3">
      <div
        aria-label="Filtrar préstamos por estado"
        className="flex flex-wrap gap-2"
        role="group"
      >
        {(
          [
            ["activos", "Activos", activos.length],
            ["otros", "Otros estados", otros.length],
            ["desconocidos", "Sin verificar", desconocidos.length],
            ["todos", "Todos", prestamos.length],
          ] as const
        ).map(([value, label, count]) => (
          <Button
            aria-pressed={filtro === value}
            key={value}
            onClick={() => setFiltro(value)}
            size="sm"
            type="button"
            variant={filtro === value ? "default" : "outline"}
          >
            {label}
            {!isLoading && !error ? ` (${count})` : ""}
          </Button>
        ))}
      </div>
      <div className={TABLA.contenedor}>
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className={TABLA.encabezado}>
            <tr>
              {PRESTAMOS_TABLE_COLUMNS.map((column) => (
                <th className={TABLA.th} key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr className={TABLA.fila}>
                <td
                  className={TABLA.vacio}
                  colSpan={PRESTAMOS_TABLE_COLUMNS.length}
                >
                  Consultando préstamos...
                </td>
              </tr>
            ) : error ? (
              <tr className={TABLA.fila}>
                <td
                  className={TABLA.vacio}
                  colSpan={PRESTAMOS_TABLE_COLUMNS.length}
                >
                  No se pudieron consultar los préstamos del socio.
                </td>
              </tr>
            ) : prestamosVisibles.length > 0 ? (
              prestamosVisibles.map((prestamo) => (
                <tr
                  // Otros estados no equivalen a créditos pagados ni libres de mora.
                  className={[
                    TABLA.fila,
                    clasificarEstadoPrestamo(prestamo) === "otros"
                      ? "text-foreground-secondary"
                      : "",
                    prestamo.legacyId ? "cursor-pointer" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={prestamo.legacyId ?? prestamo.nroCuenta}
                  onClick={() => {
                    if (prestamo.legacyId) {
                      setPrestamoAbiertoId(prestamo.legacyId);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && prestamo.legacyId) {
                      setPrestamoAbiertoId(prestamo.legacyId);
                    }
                  }}
                  tabIndex={prestamo.legacyId ? 0 : undefined}
                  title={
                    prestamo.legacyId ? "Ver detalle del préstamo" : undefined
                  }
                >
                  <td className={`${TABLA.celdaPrincipal} tabular-nums`}>
                    {prestamo.nroCuenta || PLACEHOLDER}
                  </td>
                  <td className={TABLA.celda}>
                    {prestamo.lineaPrestamoDescripcion || PLACEHOLDER}
                  </td>
                  <td className={TABLA.celda}>
                    {formatLegacyDate(prestamo.fechaEmision)}
                  </td>
                  <td className={TABLA.celdaMonto}>
                    {formatNullableAmount(prestamo.montoPrestamo) ||
                      PLACEHOLDER}
                  </td>
                  <td className={TABLA.celda}>
                    {prestamo.montoADesembolsar
                      ? formatNullableAmount(prestamo.montoADesembolsar)
                      : PLACEHOLDER}
                  </td>
                  <td className={TABLA.celdaMonto}>
                    {formatNullableAmount(prestamo.saldo) || PLACEHOLDER}
                  </td>
                  <td className={TABLA.celda}>
                    {formatLegacyDate(prestamo.vencimiento)}
                  </td>
                </tr>
              ))
            ) : (
              <tr className={TABLA.fila}>
                <td
                  className={TABLA.vacio}
                  colSpan={PRESTAMOS_TABLE_COLUMNS.length}
                >
                  {prestamos.length === 0
                    ? "El socio no tiene préstamos registrados."
                    : filtro === "activos"
                      ? "No hay préstamos activos. Podés consultar los otros estados o los pendientes de verificación."
                      : "No hay préstamos en este filtro."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PrestamoDelSocioDialog
        onOpenChange={(open) => {
          if (!open) {
            setPrestamoAbiertoId(null);
          }
        }}
        prestamoId={prestamoAbiertoId}
        solicitudId={solicitudId}
      />
    </div>
  );
}

type CancelacionesSectionProps = {
  canCreateCancelaciones: boolean;
  canManageCancelaciones: boolean;
  isEditing: boolean;
  solicitudId: string;
};

// Montos de cancelaciones siempre con centavos ("$ 254.300,50").
const montoCancelacionFormatter = new Intl.NumberFormat("es-AR", {
  currency: "ARS",
  style: "currency",
});

function formatMontoCancelacion(value: number | null | undefined) {
  return typeof value === "number"
    ? montoCancelacionFormatter.format(value)
    : PLACEHOLDER;
}

function CancelacionesSection({
  canCreateCancelaciones,
  canManageCancelaciones,
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

  // Editar y quitar no esperan al modo "Editar": cargar tampoco lo pide.
  const canManageRows = canManageCancelaciones;
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
    if (
      !window.confirm(
        `¿Quitar la cancelación de ${cancelacion.cuentaADebitar || "esta cuenta"}?`,
      )
    )
      return;
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
          monto: formatMoneyAmount(editingCancelacion.monto),
          notas: editingCancelacion.notas ?? "",
          socio: editingCancelacion.socio,
          socioLegacyId: editingCancelacion.socioLegacyId ?? "",
        }
      : undefined;

  return (
    <div className="space-y-2">
      {canCreateCancelaciones ? (
        <div className={TABLA.acciones}>
          <Button onClick={handleAdd} size="sm" type="button">
            <Plus className="size-4" />
            Nueva cancelación
          </Button>
        </div>
      ) : null}
      <div className={TABLA.contenedor}>
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className={TABLA.encabezado}>
            <tr>
              {CANCELACIONES_TABLE_COLUMNS.map((column) => (
                <th className={TABLA.th} key={column}>
                  {column}
                </th>
              ))}
              {canManageRows ? (
                <th className="w-24 px-3 py-2.5 font-semibold">
                  <span className="sr-only">Acciones</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {cancelaciones.length > 0 ? (
              cancelaciones.map((cancelacion) => (
                <tr className={TABLA.fila} key={cancelacion.id}>
                  <td className={TABLA.celdaPrincipal}>
                    {cancelacion.cuentaADebitar}
                  </td>
                  <td className={`${TABLA.celdaSecundaria} tabular-nums`}>
                    {cancelacion.cbu}
                  </td>
                  <td className={TABLA.celdaMonto}>
                    {formatMontoCancelacion(cancelacion.monto)}
                  </td>
                  <td className={TABLA.celdaSecundaria}>
                    {cancelacion.notas || PLACEHOLDER}
                  </td>
                  <td className="px-3 py-3">{cancelacion.socio}</td>
                  <td className={TABLA.celdaSecundaria}>
                    {cancelacion.cuentaBancaria}
                  </td>
                  {canManageRows ? (
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          aria-label="Editar cancelación"
                          onClick={() => handleEdit(cancelacion)}
                          title="Editar"
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          aria-label="Quitar cancelación"
                          disabled={deleteCancelacionMutation.isPending}
                          onClick={() => handleDelete(cancelacion)}
                          title="Quitar"
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
      {canCreateCancelaciones || canManageRows ? (
        <NuevaCancelacionModal
          defaultValues={modalDefaultValues}
          onOpenChange={setIsModalOpen}
          onSave={handleSave}
          open={isModalOpen}
          saveLabel={editingCancelacion ? "Guardar cambios" : "Guardar"}
          socios={socios}
          title={
            editingCancelacion ? "Editar cancelación" : "Nueva cancelación"
          }
        />
      ) : null}
    </div>
  );
}

// Lo que se hace habitualmente en cada estado va como boton en la barra azul;
// el resto de las transiciones queda en "Otras acciones". Por actionCode.
const ACCIONES_DE_ESTADO: Record<
  string,
  { primaria: string; secundaria?: string }
> = {
  CargaVendedor: { primaria: "enviar" },
  PreAprobada: { primaria: "confirmar" },
  Revisar: { primaria: "revisar_reenviar" },
  RevisionRiesgo: { primaria: "preaprobar", secundaria: "revisar" },
};

const ETIQUETA_DE_ACCION: Record<string, string> = {
  confirmar: "Confirmar",
  enviar: "Enviar a Riesgo",
  preaprobar: "Pre aprobar",
  revisar: "Devolver al vendedor",
  revisar_reenviar: "Reenviar a Riesgo",
};

type SolicitudDetailVistaTab = "credixsa" | "evaluacion" | "solicitud";

const SOLICITUD_DETAIL_VISTA_TABS: TabItem<SolicitudDetailVistaTab>[] = [
  { label: "Solicitud", value: "solicitud" },
  { label: "Evaluación", value: "evaluacion" },
  { label: "CredixSA", value: "credixsa" },
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
  // Envuelve en <label>: asocia la etiqueta al campo (lectores de pantalla y
  // clic en la etiqueta). Solo para editores de un unico campo.
  asLabel?: boolean;
  editor: ReactNode;
  highlightReadOnly?: boolean;
  isEditing: boolean;
  label: string;
  required?: boolean;
  value: ReactNode;
};

type EditableTextInputProps = {
  inputMode?: "decimal";
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

  return nombreEstado(transition.toState.code, transition.toState.name);
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
  asLabel = false,
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

  const Contenedor = asLabel ? "label" : "div";

  return (
    <Contenedor className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground-secondary">
        {label}
        {required ? <RequiredMark /> : null}
      </span>
      {editor}
    </Contenedor>
  );
}

function EditableTextInput({
  inputMode,
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
      asLabel
      appearanceStyle={appearanceStyle}
      editor={
        <input
          aria-invalid={invalid || undefined}
          className={legacyFieldClassName}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          style={disabled ? appearanceStyle : undefined}
          type={type}
          inputMode={inputMode}
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

// Localidad: siempre del buscador de localidades de Vimarx, el mismo del alta
// de la solicitud y del alta de socio. No se puede escribir texto libre. Se
// guarda el nombre, como en el alta: el finalizar y la revision documental
// leen la localidad de la solicitud como texto.
function EditableLocalidadInput({
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
  readOnlyValue: ReactNode;
  value: string;
}) {
  return (
    <EditableField
      appearanceStyle={appearanceStyle}
      editor={
        <LocalidadSelect
          disabled={disabled}
          onClear={() => onChange("")}
          onPick={(localidad) => onChange(localidad.nombre)}
          value=""
          valueLabel={value}
        />
      }
      highlightReadOnly={highlightReadOnly}
      isEditing={isEditing}
      label={label}
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
      asLabel
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
  invalid,
  isEditing,
  label,
  onChange,
  readOnlyValue,
  value,
}: {
  appearanceStyle?: CSSProperties;
  disabled?: boolean;
  highlightReadOnly?: boolean;
  invalid?: boolean;
  isEditing: boolean;
  label: string;
  onChange: (value: string) => void;
  readOnlyValue: string;
  value: string;
}) {
  return (
    <EditableField
      asLabel
      appearanceStyle={appearanceStyle}
      editor={
        <StaticMoneyInput
          aria-label={label}
          disabled={disabled}
          invalid={invalid}
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
  id,
  children,
  title,
}: {
  id?: string;
  children: ReactNode;
  title: string;
}) {
  return (
    <Section id={id} title={title}>
      {children}
    </Section>
  );
}

// La linea se cambia donde la regla del estado lo habilita (pensado para que
// RIESGO la ajuste al analizar), entre las del agente del vendedor.
function LineaField({
  isEditable,
  lineas,
  onChange,
  solicitud,
  value,
}: {
  isEditable: boolean;
  lineas: LineaPrestamoPresolicitud[];
  onChange: (value: string) => void;
  solicitud: SolicitudCoreResponse;
  value: string;
}) {
  if (!isEditable) {
    return (
      <ReadOnlyField
        label="Línea"
        value={formatText(solicitud.lineaPrestamoDescripcion)}
      />
    );
  }

  const options: StyledSelectOption[] = lineas.flatMap((linea) =>
    linea.oid && linea.descripcion
      ? [{ label: linea.descripcion.trim(), value: linea.oid }]
      : [],
  );

  // Si la linea actual no vino en la lista (dejo de estar vigente), igual se
  // muestra para no dejar el selector vacio.
  if (
    solicitud.lineaPrestamoLegacyOid &&
    !options.some((option) => option.value === solicitud.lineaPrestamoLegacyOid)
  ) {
    options.unshift({
      label: solicitud.lineaPrestamoDescripcion,
      value: solicitud.lineaPrestamoLegacyOid,
    });
  }

  const seleccionada = lineas.find((linea) => linea.oid === value);
  const limites = seleccionada
    ? [
        seleccionada.cantidadMaximaCuotas !== null
          ? `Hasta ${seleccionada.cantidadMaximaCuotas} cuotas`
          : null,
        seleccionada.montoMaximo !== null
          ? `monto máximo ${formatAmount(seleccionada.montoMaximo)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground-secondary">
        Línea
      </span>
      <StyledSelect
        onChange={onChange}
        options={options}
        placeholder="Seleccione una línea"
        searchable
        value={value}
      />
      {limites ? (
        <span className="text-xs text-foreground-muted">{limites}</span>
      ) : null}
    </div>
  );
}

function SolicitudSection({
  cuotaCalculoMensaje,
  ficha = false,
  assignmentOptions,
  assignmentValue,
  assignmentValueLabel,
  isFieldEditableByKey,
  isEditing,
  isExecutiveAssignmentDisabled,
  lineas,
  montoTopeError,
  mostrarEjecutivo,
  onAssignmentChange,
  onBooleanChange,
  onChange,
  readonlyAppearanceStyle,
  ultimaNovedad,
  solicitud,
  values,
}: {
  cuotaCalculoMensaje?: string;
  // Edicion con la misma grilla que la lectura (tarjeta Prestamo).
  ficha?: boolean;
  /** El monto cargado pasa el aprobado por Riesgo. */
  montoTopeError?: string | null;
  assignmentOptions: StyledSelectOption[];
  assignmentValue: string;
  assignmentValueLabel: string;
  isFieldEditableByKey: (fieldKey: string) => boolean;
  isEditing: boolean;
  lineas: LineaPrestamoPresolicitud[];
  isExecutiveAssignmentDisabled: boolean;
  /** El vendedor no ve quien analiza su solicitud: se oculta solo a Vendedores. */
  mostrarEjecutivo: boolean;
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

  if (ficha) {
    return (
      <>
        <div className={DOS_COLUMNAS}>
          <div className="col-span-2">
            <LineaField
              isEditable={
                isEditing &&
                isFieldEditableByKey("solicitud.lineaPrestamoLegacyOid")
              }
              lineas={lineas}
              onChange={(value) => onChange("lineaPrestamoLegacyOid", value)}
              solicitud={solicitud}
              value={values.lineaPrestamoLegacyOid}
            />
          </div>
          <div>
            <EditableMoneyInput
              {...getReadonlyProps("solicitud.montoAFinanciar")}
              disabled={!isFieldEditableByKey("solicitud.montoAFinanciar")}
              invalid={isEditing && Boolean(montoTopeError)}
              isEditing={isEditing}
              label="Monto a financiar"
              onChange={(value) => onChange("montoAFinanciar", value)}
              readOnlyValue={formatAmount(solicitud.montoAFinanciar)}
              value={values.montoAFinanciar}
            />
            {isEditing && montoTopeError ? (
              <span role="alert" className="text-xs text-danger">
                {montoTopeError}
              </span>
            ) : null}
          </div>
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
          <div>
            <EditableMoneyInput
              {...getReadonlyProps("solicitud.montoAFinanciar")}
              disabled={!isFieldEditableByKey("solicitud.montoAFinanciar")}
              isEditing={isEditing}
              label="Cuota por mes"
              onChange={(value) => onChange("cuotaResultante", value)}
              readOnlyValue={values.cuotaResultante || "Cálculo no disponible"}
              value={values.cuotaResultante}
            />
            {isEditing && cuotaCalculoMensaje ? (
              <p
                role="status"
                className="mt-1 text-xs text-foreground-secondary"
              >
                {cuotaCalculoMensaje}
              </p>
            ) : null}
          </div>
          <EditableMoneyInput
            {...getReadonlyProps("solicitud.cupoTitular")}
            disabled={!isFieldEditableByKey("solicitud.cupoTitular")}
            isEditing={isEditing}
            label="Cupo del titular"
            onChange={(value) => onChange("cupoTitular", value)}
            readOnlyValue={formatAmount(solicitud.cupoTitular)}
            value={values.cupoTitular}
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
                  disabled={
                    !isFieldEditableByKey("solicitud.firmaDigitalmente")
                  }
                  onCheckedChange={(checked) =>
                    onBooleanChange("firmaDigitalmente", checked === true)
                  }
                />
                Sí
              </label>
            }
            highlightReadOnly={
              !isFieldEditableByKey("solicitud.firmaDigitalmente")
            }
            isEditing={isEditing}
            label="Firma digital"
            value={formatBoolean(solicitud.firmaDigitalmente)}
          />
          <EditableDateInput
            {...getReadonlyProps("solicitud.fechaPrimerVencimiento")}
            disabled={!isFieldEditableByKey("solicitud.fechaPrimerVencimiento")}
            isEditing={isEditing}
            label="Primer vencimiento"
            onChange={(value) => onChange("fechaPrimerVencimiento", value)}
            readOnlyValue={formatLegacyDate(solicitud.fechaPrimerVencimiento)}
            value={values.fechaPrimerVencimiento}
          />
        </div>
        <div
          className={`${DOS_COLUMNAS} mt-3 border-t border-border-soft pt-3`}
        >
          <EditableField
            appearanceStyle={readonlyAppearanceStyle}
            isEditing={false}
            editor={null}
            label="Vendedor"
            value={formatText(solicitud.vendedorSolicitud)}
          />
          {mostrarEjecutivo ? (
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
              label="Ejecutivo"
              value={assignmentValueLabel}
            />
          ) : null}
          {solicitud.nroOperacion ? (
            <EditableTextInput
              {...getReadonlyProps("solicitud.nroOperacion")}
              disabled={!isFieldEditableByKey("solicitud.nroOperacion")}
              isEditing={isEditing}
              label="Nro. de operación"
              onChange={(value) => onChange("nroOperacion", value)}
              readOnlyValue={formatText(solicitud.nroOperacion)}
              value={values.nroOperacion}
            />
          ) : null}
          {solicitud.motivo ? (
            <EditableTextInput
              {...getReadonlyProps("solicitud.motivo")}
              disabled={!isFieldEditableByKey("solicitud.motivo")}
              isEditing={isEditing}
              label="Motivo"
              onChange={(value) => onChange("motivo", value)}
              readOnlyValue={formatText(solicitud.motivo)}
              value={values.motivo}
            />
          ) : null}
          {solicitud.linkFirmaDigital ? (
            <div className="col-span-2">
              <ReadOnlyField
                label="Link de firma digital"
                value={
                  <LinkFirmaDigital
                    conWhatsapp={false}
                    url={solicitud.linkFirmaDigital}
                  />
                }
              />
            </div>
          ) : null}
          <div className="col-span-2">
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
              highlightReadOnly={
                !isFieldEditableByKey("solicitud.observaciones")
              }
              isEditing={isEditing}
              label="Observaciones"
              value={formatText(solicitud.observaciones)}
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <DetailCard title="Solicitud">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <LineaField
          isEditable={
            isEditing &&
            isFieldEditableByKey("solicitud.lineaPrestamoLegacyOid")
          }
          lineas={lineas}
          onChange={(value) => onChange("lineaPrestamoLegacyOid", value)}
          solicitud={solicitud}
          value={values.lineaPrestamoLegacyOid}
        />
        <EditableDateInput
          {...getReadonlyProps("solicitud.fechaPrimerVencimiento")}
          disabled={!isFieldEditableByKey("solicitud.fechaPrimerVencimiento")}
          isEditing={isEditing}
          label="Fecha primer vencimiento"
          onChange={(value) => onChange("fechaPrimerVencimiento", value)}
          readOnlyValue={formatLegacyDate(solicitud.fechaPrimerVencimiento)}
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
        <div>
          <EditableMoneyInput
            {...getReadonlyProps("solicitud.montoAFinanciar")}
            disabled={!isFieldEditableByKey("solicitud.montoAFinanciar")}
            invalid={isEditing && Boolean(montoTopeError)}
            isEditing={isEditing}
            label="Monto a financiar"
            onChange={(value) => onChange("montoAFinanciar", value)}
            readOnlyValue={formatAmount(solicitud.montoAFinanciar)}
            value={values.montoAFinanciar}
          />
          {isEditing && montoTopeError ? (
            <span role="alert" className="text-xs text-danger">
              {montoTopeError}
            </span>
          ) : null}
        </div>
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
        <div>
          <EditableMoneyInput
            {...getReadonlyProps("solicitud.montoAFinanciar")}
            disabled={!isFieldEditableByKey("solicitud.montoAFinanciar")}
            isEditing={isEditing}
            label="Cuota resultante"
            onChange={(value) => onChange("cuotaResultante", value)}
            readOnlyValue={values.cuotaResultante || "Cálculo no disponible"}
            value={values.cuotaResultante}
          />
          {isEditing && cuotaCalculoMensaje ? (
            <p role="status" className="mt-1 text-xs text-foreground-secondary">
              {cuotaCalculoMensaje}
            </p>
          ) : null}
        </div>
        <EditableTextInput
          {...getReadonlyProps("solicitud.motivo")}
          disabled={!isFieldEditableByKey("solicitud.motivo")}
          isEditing={isEditing}
          label="Motivo"
          onChange={(value) => onChange("motivo", value)}
          readOnlyValue={formatText(solicitud.motivo)}
          value={values.motivo}
        />
        {mostrarEjecutivo ? (
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
        ) : null}
        <EditableField
          appearanceStyle={readonlyAppearanceStyle}
          isEditing={false}
          editor={null}
          label="Vendedor solicitud"
          value={formatText(solicitud.vendedorSolicitud)}
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
              <LinkFirmaDigital url={solicitud.linkFirmaDigital} />
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
  datosLaborales,
  datosLaboralesValues,
  errors,
  ficha = false,
  isFieldEditableByKey,
  isEditing,
  onBooleanChange,
  onChange,
  onDatosLaboralesChange,
  readonlyAppearanceStyle,
  titular,
  values,
}: {
  datosLaborales: SolicitudCoreDatosLaboralesResponse;
  datosLaboralesValues: EditableSolicitudCoreValues["datosLaborales"];
  // Edicion con la misma grilla que la lectura (detalle-lectura).
  ficha?: boolean;
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
  onDatosLaboralesChange: (
    field: keyof EditableSolicitudCoreValues["datosLaborales"],
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

  if (ficha) {
    return (
      <div className={COLUMNAS_TITULAR}>
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
        <EditableTextInput
          {...getReadonlyProps("titular.apellidoDenominacion")}
          disabled={!isFieldEditableByKey("titular.apellidoDenominacion")}
          invalid={!!errors?.apellidoDenominacion}
          isEditing={isEditing}
          label="Apellido"
          onChange={(value) => onChange("apellidoDenominacion", value)}
          readOnlyValue={formatText(titular.apellidoDenominacion)}
          required
          value={values.apellidoDenominacion}
        />
        <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-2">
          <EditableSelectInput
            {...getReadonlyProps("titular.tipoDocumento")}
            disabled={!isFieldEditableByKey("titular.tipoDocumento")}
            invalid={!!errors?.tipoDocumento}
            isEditing={isEditing}
            label="Tipo"
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
            label="Documento"
            onChange={(value) => onChange("nroDocumento", value)}
            readOnlyValue={formatText(titular.nroDocumento)}
            required
            value={values.nroDocumento}
          />
        </div>
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
        <EditableDateInput
          {...getReadonlyProps("titular.fechaNacimiento")}
          disabled={!isFieldEditableByKey("titular.fechaNacimiento")}
          invalid={!!errors?.fechaNacimiento}
          isEditing={isEditing}
          label="Nacimiento"
          onChange={(value) => onChange("fechaNacimiento", value)}
          readOnlyValue={formatLegacyDate(titular.fechaNacimiento)}
          required
          value={values.fechaNacimiento}
        />
        <EditableSelectInput
          {...getReadonlyProps("titular.sexo")}
          disabled={!isFieldEditableByKey("titular.sexo")}
          invalid={!!errors?.sexo}
          isEditing={isEditing}
          label="Sexo"
          onChange={(value) => onChange("sexo", value)}
          options={SEXO_OPTIONS}
          readOnlyValue={formatText(sexoLegible(titular.sexo))}
          required
          value={normalizarSexo(values.sexo)}
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
          {...getReadonlyProps("titular.nacionalidad")}
          disabled={!isFieldEditableByKey("titular.nacionalidad")}
          isEditing={isEditing}
          label="Nacionalidad"
          onChange={(value) => onChange("nacionalidad", value)}
          readOnlyValue={formatText(titular.nacionalidad)}
          value={values.nacionalidad}
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
        <div className="lg:col-span-2">
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
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-start gap-2 lg:col-span-2">
          <EditableTextInput
            {...getReadonlyProps("titular.domicilioCalle")}
            disabled={!isFieldEditableByKey("titular.domicilioCalle")}
            isEditing={isEditing}
            label="Calle"
            onChange={(value) => onChange("domicilioCalle", value)}
            readOnlyValue={formatText(titular.domicilioCalle)}
            value={values.domicilioCalle}
          />
          <EditableTextInput
            {...getReadonlyProps("titular.nroPuerta")}
            disabled={!isFieldEditableByKey("titular.nroPuerta")}
            isEditing={isEditing}
            label="Número"
            onChange={(value) => onChange("nroPuerta", value)}
            readOnlyValue={formatText(titular.nroPuerta)}
            value={values.nroPuerta}
          />
        </div>
        <EditableLocalidadInput
          {...getReadonlyProps("titular.localidad")}
          disabled={!isFieldEditableByKey("titular.localidad")}
          isEditing={isEditing}
          label="Localidad"
          onChange={(value) => onChange("localidad", value)}
          readOnlyValue={formatText(titular.localidad)}
          value={values.localidad}
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
              Sí
            </label>
          }
          highlightReadOnly={
            !isFieldEditableByKey("titular.personaExpuestaPoliticamente")
          }
          isEditing={isEditing}
          label="Persona expuesta políticamente"
          value={formatBoolean(titular.personaExpuestaPoliticamente)}
        />
        <EditableTextInput
          {...getReadonlyProps("datosLaborales.empleador")}
          disabled={!isFieldEditableByKey("datosLaborales.empleador")}
          isEditing={isEditing}
          label="Empleador"
          onChange={(value) => onDatosLaboralesChange("empleador", value)}
          readOnlyValue={formatText(datosLaborales.empleador)}
          value={datosLaboralesValues.empleador}
        />
        <EditableDateInput
          {...getReadonlyProps("datosLaborales.fechaIngresoLaboral")}
          disabled={!isFieldEditableByKey("datosLaborales.fechaIngresoLaboral")}
          isEditing={isEditing}
          label="Ingreso laboral"
          onChange={(value) =>
            onDatosLaboralesChange("fechaIngresoLaboral", value)
          }
          readOnlyValue={formatLegacyDate(datosLaborales.fechaIngresoLaboral)}
          value={datosLaboralesValues.fechaIngresoLaboral}
        />
        <div className="lg:col-span-2">
          <EditableMoneyInput
            {...getReadonlyProps("datosLaborales.montoRecibo")}
            disabled={!isFieldEditableByKey("datosLaborales.montoRecibo")}
            isEditing={isEditing}
            label="Monto del recibo"
            onChange={(value) => onDatosLaboralesChange("montoRecibo", value)}
            readOnlyValue={formatAmount(datosLaborales.montoRecibo)}
            value={datosLaboralesValues.montoRecibo}
          />
        </div>
        <div className="lg:col-span-2">
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
        <div className="lg:col-span-2">
          <EditableTextInput
            {...getReadonlyProps("titular.cbuNoHabitual")}
            disabled={!isFieldEditableByKey("titular.cbuNoHabitual")}
            isEditing={isEditing}
            label="CBU cuenta no habitual"
            onChange={(value) => onChange("cbuNoHabitual", value)}
            readOnlyValue={formatText(titular.cbuNoHabitual)}
            value={values.cbuNoHabitual}
          />
        </div>
      </div>
    );
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
        readOnlyValue={formatLegacyDate(titular.fechaNacimiento)}
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
        readOnlyValue={formatText(sexoLegible(titular.sexo))}
        required
        value={normalizarSexo(values.sexo)}
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
      <EditableLocalidadInput
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
      <EditableTextInput
        {...getReadonlyProps("titular.cbuNoHabitual")}
        disabled={!isFieldEditableByKey("titular.cbuNoHabitual")}
        isEditing={isEditing}
        label="CBU Transferencias Cuenta No Habitual"
        onChange={(value) => onChange("cbuNoHabitual", value)}
        readOnlyValue={formatText(titular.cbuNoHabitual)}
        value={values.cbuNoHabitual}
      />
      {/* También en Económicos/Laborales: acá queda a mano aunque esa pestaña no muestre campos. */}
      <EditableMoneyInput
        {...getReadonlyProps("datosLaborales.montoRecibo")}
        disabled={!isFieldEditableByKey("datosLaborales.montoRecibo")}
        isEditing={isEditing}
        label="Monto recibo"
        onChange={(value) => onDatosLaboralesChange("montoRecibo", value)}
        readOnlyValue={formatAmount(datosLaborales.montoRecibo)}
        value={datosLaboralesValues.montoRecibo}
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
        readOnlyValue={formatText(sexoLegible(conyuge.sexo))}
        value={normalizarSexo(values.sexo)}
      />
      <EditableDateInput
        {...getReadonlyProps("conyuge.fechaNacimiento")}
        disabled={!isFieldEditableByKey("conyuge.fechaNacimiento")}
        isEditing={isEditing}
        label="Fecha nacimiento"
        onChange={(value) => onChange("fechaNacimiento", value)}
        readOnlyValue={formatLegacyDate(conyuge.fechaNacimiento)}
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
        readOnlyValue={formatLegacyDate(datosLaborales.fechaIngresoLaboral)}
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
      <EditableLocalidadInput
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
  // Cada fila tiene sus acciones (ver, descargar, reemplazar, quitar); antes
  // habia que tildar casillas y usar los botones de arriba.
  const [adjuntoAQuitar, setAdjuntoAQuitar] =
    useState<SolicitudCoreAdjuntoResponse | null>(null);
  const columnas = [
    "Archivo",
    "Tipo",
    "Descripción",
    "Estado",
    "Tamaño",
    "Subido por",
    "Fecha",
  ];
  const tieneAcciones =
    Boolean(onPreviewAdjunto) ||
    canDownloadAdjunto ||
    Boolean(onEditAdjunto) ||
    canDeleteAdjunto;
  const cantidadColumnas = columnas.length + (tieneAcciones ? 1 : 0);

  async function handleQuitarAdjunto() {
    if (!adjuntoAQuitar) return;
    try {
      await onDeleteAdjunto(adjuntoAQuitar);
      setAdjuntoAQuitar(null);
    } catch {
      // El error ya lo informa quien borra; el dialogo queda abierto.
    }
  }

  const content = (
    <div
      id="solicitud-adjuntos"
      tabIndex={-1}
      className="space-y-3 scroll-mt-36"
    >
      {canCreateAdjunto ? (
        <div className={TABLA.acciones}>
          <Button
            disabled={isUploading}
            onClick={() => setIsAdjuntoModalOpen(true)}
            size="sm"
            type="button"
          >
            <Plus className="size-4" />
            Agregar adjunto
          </Button>
        </div>
      ) : null}

      <div className={TABLA.contenedor}>
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className={TABLA.encabezado}>
            <tr>
              {columnas.map((columna) => (
                <th className={TABLA.th} key={columna}>
                  {columna}
                </th>
              ))}
              {tieneAcciones ? (
                <th className={`${TABLA.th} w-36`}>
                  <span className="sr-only">Acciones</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr className={TABLA.fila}>
                <td className={TABLA.vacio} colSpan={cantidadColumnas}>
                  Cargando adjuntos...
                </td>
              </tr>
            ) : errorMessage ? (
              <tr className={TABLA.fila}>
                <td
                  className="px-3 py-6 text-center text-sm text-danger"
                  colSpan={cantidadColumnas}
                >
                  {errorMessage}
                </td>
              </tr>
            ) : adjuntos.length > 0 ? (
              adjuntos.map((adjunto) => (
                <tr className={TABLA.fila} key={adjunto.id}>
                  <td className={`${TABLA.celdaPrincipal} break-all`}>
                    {formatText(adjunto.archivoNombre)}
                  </td>
                  <td className={TABLA.celda}>
                    {formatText(adjunto.tipoAdjunto)}
                  </td>
                  <td className={TABLA.celdaSecundaria}>
                    {formatText(adjunto.descripcion)}
                  </td>
                  <td className={TABLA.celda}>
                    {formatText(adjunto.estadoAdjunto)}
                  </td>
                  <td className={`${TABLA.celdaSecundaria} tabular-nums`}>
                    {formatBytes(adjunto.archivoSizeBytes)}
                  </td>
                  <td className={TABLA.celdaSecundaria}>
                    {formatText(adjunto.uploadedByName ?? adjunto.uploadedBy)}
                  </td>
                  <td className={`${TABLA.celdaSecundaria} tabular-nums`}>
                    {formatDateTime(adjunto.uploadedAt)}
                  </td>
                  {tieneAcciones ? (
                    <td className={TABLA.celda}>
                      <div className="flex items-center justify-end gap-1">
                        {onPreviewAdjunto ? (
                          <Button
                            aria-label={`Ver ${adjunto.archivoNombre ?? "adjunto"}`}
                            className={TABLA.icono}
                            disabled={previewingAdjuntoId === adjunto.id}
                            onClick={() => onPreviewAdjunto(adjunto)}
                            size="icon-sm"
                            title="Ver"
                            type="button"
                            variant="ghost"
                          >
                            <Eye className="size-4" />
                          </Button>
                        ) : null}
                        {canDownloadAdjunto ? (
                          <Button
                            aria-label={`Descargar ${adjunto.archivoNombre ?? "adjunto"}`}
                            className={TABLA.icono}
                            disabled={downloadingAdjuntoId === adjunto.id}
                            onClick={() => void onDownloadAdjunto(adjunto)}
                            size="icon-sm"
                            title="Descargar"
                            type="button"
                            variant="ghost"
                          >
                            <Download className="size-4" />
                          </Button>
                        ) : null}
                        {onEditAdjunto ? (
                          <Button
                            aria-label={`Reemplazar ${adjunto.archivoNombre ?? "adjunto"}`}
                            className={TABLA.icono}
                            disabled={editingAdjuntoId === adjunto.id}
                            onClick={() => onEditAdjunto(adjunto)}
                            size="icon-sm"
                            title="Reemplazar"
                            type="button"
                            variant="ghost"
                          >
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                        {canDeleteAdjunto ? (
                          <Button
                            aria-label={`Quitar ${adjunto.archivoNombre ?? "adjunto"}`}
                            className={TABLA.iconoPeligro}
                            disabled={deletingAdjuntoId === adjunto.id}
                            onClick={() => setAdjuntoAQuitar(adjunto)}
                            size="icon-sm"
                            title="Quitar"
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            ) : (
              <tr className={TABLA.fila}>
                <td className="px-3 py-3" colSpan={cantidadColumnas}>
                  <TableEmptyState />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <DialogRoot
        onOpenChange={(open) => {
          if (!open) setAdjuntoAQuitar(null);
        }}
        open={adjuntoAQuitar !== null}
      >
        <DialogContent className="max-w-[440px] p-0">
          <div className="space-y-3 p-5">
            <DialogTitle className="font-marca text-lg font-bold text-marino">
              Quitar adjunto
            </DialogTitle>
            <DialogDescription className="text-sm text-foreground-secondary">
              ¿Quitar {adjuntoAQuitar?.archivoNombre ?? "este adjunto"}? No se
              puede deshacer.
            </DialogDescription>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                disabled={deletingAdjuntoId !== null}
                onClick={() => setAdjuntoAQuitar(null)}
                type="button"
                variant="outline"
              >
                Cancelar
              </Button>
              <Button
                className="bg-danger text-danger-foreground hover:bg-danger/90"
                disabled={deletingAdjuntoId !== null}
                onClick={() => void handleQuitarAdjunto()}
                type="button"
              >
                {deletingAdjuntoId !== null ? "Quitando..." : "Quitar"}
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
  canCreateCancelaciones,
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
  ocultarCancelaciones = false,
  onTabChange,
  onTitularBooleanChange,
  onTitularChange,
  readonlyAppearanceStyle,
  shouldShowDatosLaborales,
  soloComplementos = false,
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
  canCreateCancelaciones: boolean;
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
  // Vendedores no carga ni ve cancelaciones: es tarea de Riesgo.
  ocultarCancelaciones?: boolean;
  onTabChange: (tab: SolicitanteTab) => void;
  onTitularBooleanChange: (value: boolean) => void;
  onTitularChange: (
    field: keyof EditableSolicitudCoreValues["titular"],
    value: string,
  ) => void;
  readonlyAppearanceStyle?: CSSProperties;
  shouldShowDatosLaborales: boolean;
  // Modo lectura: los datos personales ya estan arriba, aca solo lo demas.
  soloComplementos?: boolean;
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
  const { data: currentUserPrestamos } = useAuthSessionQuery();
  const canViewPrestamos = canViewPrestamosDelSocio(currentUserPrestamos);
  const activeContentTab: SolicitanteContentTab =
    activeTab === "adjuntos" ||
    (activeTab === "cancelaciones" && !ocultarCancelaciones) ||
    activeTab === "prestamos" ||
    activeTab === "refinanciacion" ||
    activeTab === "solicitudes"
      ? activeTab
      : soloComplementos
        ? "adjuntos"
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

  const pestanas = (
    canViewPrestamos
      ? [
          ...SOLICITANTE_CONTENT_TABS.slice(0, 2),
          REFINANCIACION_TAB,
          ...SOLICITANTE_CONTENT_TABS.slice(2),
          PRESTAMOS_TAB,
          { label: "Solicitudes", value: "solicitudes" as const },
        ]
      : SOLICITANTE_CONTENT_TABS
  )
    .filter((tab) => !soloComplementos || tab.value !== "datosPersonales")
    .filter((tab) => !ocultarCancelaciones || tab.value !== "cancelaciones")
    .sort((a, b) =>
      soloComplementos
        ? ORDEN_MAS_INFORMACION.indexOf(a.value) -
          ORDEN_MAS_INFORMACION.indexOf(b.value)
        : 0,
    );
  const cambiarPestana = (tab: SolicitanteContentTab) => {
    if (
      tab === "adjuntos" ||
      tab === "cancelaciones" ||
      tab === "prestamos" ||
      tab === "refinanciacion" ||
      tab === "solicitudes"
    ) {
      onTabChange(tab);
      return;
    }

    onTabChange("solicitante");
    onDatosPersonalesTabChange(tab);
  };
  const contenido = (
    <>
      {activeContentTab === "solicitudes" && canViewPrestamos ? (
        <SolicitudesDelTitularSection
          solicitudId={solicitudId}
          documento={titular.nroDocumento}
        />
      ) : activeContentTab === "refinanciacion" && canViewPrestamos ? (
        <RefinanciacionSection
          canEdit={canCreateCancelaciones || canManageCancelaciones}
          isActive={activeContentTab === "refinanciacion"}
          solicitudId={solicitudId}
        />
      ) : activeContentTab === "prestamos" ? (
        <PrestamosDelSocioSection
          isActive={activeContentTab === "prestamos"}
          solicitudId={solicitudId}
        />
      ) : activeContentTab === "cancelaciones" ? (
        <CancelacionesSection
          canCreateCancelaciones={canCreateCancelaciones}
          canManageCancelaciones={canManageCancelaciones}
          isEditing={isEditing}
          solicitudId={solicitudId}
        />
      ) : activeContentTab !== "adjuntos" ? (
        <div>
          {activeContentTab === "datosPersonales" ? (
            <TitularFields
              datosLaborales={datosLaborales}
              datosLaboralesValues={titularDatosLaboralesValues}
              errors={titularErrors}
              isFieldEditableByKey={isFieldEditableByKey}
              isEditing={isEditing}
              onBooleanChange={onTitularBooleanChange}
              onChange={onTitularChange}
              onDatosLaboralesChange={onDatosLaboralesChange}
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
    </>
  );

  // En lectura: tarjeta blanca como Titular y Prestamo, siempre abierta; la
  // pestana activa es el titulo (en verde).
  if (soloComplementos) {
    return (
      <section
        className="rounded-lg border border-border bg-surface p-4"
        id="solicitante-prestamos"
        tabIndex={-1}
      >
        <div
          aria-label="Más información"
          className="mb-3 flex flex-wrap gap-x-6 gap-y-1 border-b border-border-soft"
          role="tablist"
        >
          {pestanas.map((tab) => {
            const activa = tab.value === activeContentTab;
            return (
              <button
                aria-selected={activa}
                className={`-mb-px border-b-[3px] pb-2 font-marca text-[0.9375rem] tracking-[-0.01em] transition-colors ${
                  activa
                    ? "border-verde font-bold text-marino"
                    : "border-transparent font-semibold text-foreground-secondary hover:text-marino"
                }`}
                key={tab.value}
                onClick={() => cambiarPestana(tab.value)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {contenido}
      </section>
    );
  }

  return (
    <DetailCard
      id="solicitante-prestamos"
      title={soloComplementos ? "Más información" : "Solicitante"}
    >
      <SectionTabs<SolicitanteContentTab>
        activeTab={activeContentTab}
        onTabChange={cambiarPestana}
        tabs={pestanas}
      />
      {contenido}
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
  const { topbarSlot } = useOutletContext<{
    topbarSlot?: HTMLElement | null;
  }>();
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
  const documentReview = useDocumentReview(solicitudId);
  const linkedLoan = useLinkedLoanStatus(solicitudId);
  const canViewCalculadora = canAccessRiesgoTools(currentUser);
  // La firma del legajo es de Legajos: a Riesgo solo lo confunde.
  const verFirmaLegajo = !(
    currentUser?.workflowOwner?.code === "RIESGO" && !currentUser.isSystemAdmin
  );
  const solicitudCapabilities = solicitud?.capabilities;
  const canChangeState = solicitudCapabilities?.canChangeState ?? false;
  // Guarda la evaluacion Riesgo con la solicitud a cargo, o un admin. El
  // backend vuelve a chequearlo.
  const canGuardarEvaluacion =
    currentUser?.isSystemAdmin === true ||
    (currentUser?.workflowOwner?.code === "RIESGO" &&
      Boolean(currentUser.workflowOwnerId) &&
      currentUser.workflowOwnerId === solicitud?.estadoActual.ownerId &&
      (solicitudCapabilities?.canEdit ?? false));
  const {
    data: adjuntos = [],
    error: adjuntosError,
    isLoading: isLoadingAdjuntos,
  } = useSolicitudCoreAdjuntosQuery(solicitudId);
  const {
    data: workflowTransitions = [],
    error: workflowTransitionsError,
    isLoading: isLoadingWorkflowTransitions,
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
  const amountLocked =
    createPrestamoLegacyMutation.isPending ||
    linkedLoan.isError ||
    linkedLoan.data?.status === "unavailable" ||
    (Boolean(solicitud?.legacyOid) && linkedLoan.data?.amountEditable !== true);
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
  const { data: lineasSimulador = [], isLoading: isLoadingLineasSimulador } =
    useLineasPrestamoQuery(solicitudId);
  const [datosPersonalesTab, setDatosPersonalesTab] =
    useState<DatosPersonalesTab>("datosPersonales");
  const [solicitanteNavigation, setSolicitanteNavigation] = useState(0);
  const [solicitanteTab, setSolicitanteTab] =
    useState<SolicitanteTab>("solicitante");
  const [vistaTab, setVistaTab] =
    useState<SolicitudDetailVistaTab>("solicitud");
  const [reciboView, setReciboView] = useState<{
    solicitudId: string;
    selectedId: string | null;
  } | null>(null);
  const recibos = getRecibosDeSolicitud(adjuntos, solicitudId);
  const visorRecibosOpen = reciboView?.solicitudId === solicitudId;
  const [evaluacionConCambios, setEvaluacionConCambios] = useState(false);
  // La cabecera unica siempre es compacta (antes se podia expandir).
  const headerExpanded = false;

  function cambiarVistaTab(tab: SolicitudDetailVistaTab) {
    // La planilla se desmonta al salir de la pestaña: lo no guardado se pierde.
    if (
      vistaTab === "evaluacion" &&
      tab !== "evaluacion" &&
      evaluacionConCambios &&
      !window.confirm(
        "Hay cambios sin guardar en la evaluación. Si cambiás de pestaña se pierden. ¿Continuar?",
      )
    ) {
      return false;
    }

    if (tab !== "evaluacion") {
      setReciboView(null);
      setEvaluacionConCambios(false);
    }

    setVistaTab(tab);
    return true;
  }
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
  const [isGenerarPrestamoModalOpen, setIsGenerarPrestamoModalOpen] =
    useState(false);

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
  const canCreateCancelaciones =
    solicitudCapabilities?.canCreateCancelaciones ??
    solicitudCapabilities?.canManageCancelaciones ??
    false;
  const canManageCancelaciones =
    solicitudCapabilities?.canManageCancelaciones ?? false;
  const canManageAdjuntos = canUploadAdjuntos || canDeleteAdjuntos;
  const canEnterEditMode =
    !solicitud?.loanReplacementPending &&
    canEditSolicitud &&
    (hasEditableSolicitudFields || canManageAdjuntos);
  const isSolicitudFieldEditable = (fieldKey: string) =>
    !(fieldKey === "solicitud.montoAFinanciar" && amountLocked) &&
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
      workflowTransitions
        .filter((transition) => transition.actionCode !== "liquidar")
        .map((transition) => ({
          disabled:
            transition.blockedReason !== null ||
            (documentReview.data?.enabled === true &&
              ["transferir", "devolver_a_liquidada"].includes(
                transition.actionCode,
              )),
          disabledReason:
            documentReview.data?.enabled &&
            ["transferir", "devolver_a_liquidada"].includes(
              transition.actionCode,
            )
              ? "Registrá la decisión humana en Revisión de firma."
              : (transition.blockedReason ?? undefined),
          label: formatWorkflowTransitionOptionLabel(
            transition,
            solicitud?.estadoActual.code,
          ),
          value: transition.id,
        })),
    [
      solicitud?.estadoActual.code,
      workflowTransitions,
      documentReview.data?.enabled,
    ],
  );
  const analysisTransition = workflowTransitions.find(
    (transition) => transition.actionCode === "liquidar",
  );
  const analysisActionLabel = documentReview.data?.signature?.approved
    ? "Mandar a transferir"
    : "Mandar a revisar firma";
  const analysisBlockedReason =
    analysisTransition?.blockedReason ??
    (linkedLoan.isPending ||
    linkedLoan.isError ||
    linkedLoan.data?.status === "unavailable"
      ? "Esperá a que se verifique el préstamo en Vimarx."
      : linkedLoan.data?.status !== "active"
        ? "Se requiere un préstamo vigente."
        : !linkedLoan.data.matchesAmount
          ? "El monto del préstamo debe coincidir con la solicitud."
          : documentReview.isPending || documentReview.isError
            ? "Esperá a que se compruebe la situación de firma."
            : null);

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

  const [cuotaObjetivoTexto, setCuotaObjetivoTexto] = useState<string | null>(
    null,
  );
  const condicionesEdicion = editableValues?.solicitud;
  const lineaEdicion = lineasSimulador.find(
    (linea) => linea.oid === condicionesEdicion?.lineaPrestamoLegacyOid,
  );
  const cuotaEdicion = useCuotaCalculada(
    {
      ...(cuotaObjetivoTexto !== null && parseMoneyValue(cuotaObjetivoTexto) > 0
        ? { cuotaObjetivo: parseMoneyValue(cuotaObjetivoTexto) }
        : {}),
      solicitudId,
      capitalPuro: false,
      lineaId: Number(condicionesEdicion?.lineaPrestamoLegacyOid),
      montoAFinanciar: parseMoneyValue(
        cuotaObjetivoTexto !== null
          ? (condicionesEdicion?.montoAFinanciar ?? "")
          : ajustarMontoTexto(
              condicionesEdicion?.montoAFinanciar ?? "",
              lineaEdicion,
            ),
      ),
      cuotas: Number(
        ajustarCuotasTexto(condicionesEdicion?.cuotas ?? "", lineaEdicion),
      ),
      ...(condicionesEdicion?.fechaPrimerVencimiento
        ? { fechaPrimerVencimiento: condicionesEdicion.fechaPrimerVencimiento }
        : {}),
    },
    Boolean(
      isEditing &&
      (cuotaObjetivoTexto === null ||
        parseMoneyValue(cuotaObjetivoTexto) > 0) &&
      lineaEdicion &&
      condicionesEdicion &&
      Number(condicionesEdicion.cuotas) > 0 &&
      parseMoneyValue(condicionesEdicion.montoAFinanciar) > 0,
    ),
    (result) => {
      if (
        parseMoneyValue(condicionesEdicion?.montoAFinanciar ?? "") !==
          result.montoAFinanciar ||
        Number(condicionesEdicion?.cuotas) !== result.cuotas
      )
        void queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.lineasPrestamo(solicitudId),
        });
      setEditableValues((current) =>
        current
          ? {
              ...current,
              solicitud: {
                ...current.solicitud,
                montoAFinanciar:
                  amountLocked ||
                  parseMoneyValue(current.solicitud.montoAFinanciar) ===
                    result.montoAFinanciar
                    ? current.solicitud.montoAFinanciar
                    : formatMoneyAmount(result.montoAFinanciar),
                cuotas: String(result.cuotas),
              },
            }
          : current,
      );
    },
  );
  // legacyOid es el ID interno del prestamo en Vimarx; operativamente se usa
  // su NroCuenta, que se consulta en vivo. Vendedores no tienen acceso.
  const canViewPrestamoGenerado =
    Boolean(currentUser) && canViewPrestamosDelSocio(currentUser);
  const prestamoGeneradoQuery = usePrestamoDelSocioQuery(
    solicitudId,
    canViewPrestamoGenerado ? (solicitud?.legacyOid ?? null) : null,
  );
  const nroCuentaPrestamo =
    prestamoGeneradoQuery.data?.prestamo.nroCuenta ?? null;
  // Misma consulta (y cache) que el chip "Es socio" del encabezado: si ya es
  // socio, "Crear socio" no aplica.
  const socioQuery = useQuery({
    enabled: Boolean(solicitud),
    queryFn: () => datosRapidosApi.socio(solicitudId),
    queryKey: [
      "solicitudes-core",
      "datos-rapidos",
      solicitudId,
      JSON.stringify([
        solicitud?.titular.nroDocumento,
        solicitud?.titular.tipoDocumento,
        solicitud?.lineaPrestamoLegacyOid,
      ]),
      "persona",
      "socio",
    ],
    retry: false,
  });
  const esSocio = socioIndicator(socioQuery).member;

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
  const topeMontoRiesgo = getTopeMontoRiesgo(currentUser, resolvedSolicitud);
  const montoTopeError = isEditing
    ? getMontoSuperaTopeError(
        parseMoneyValue(currentValues.solicitud.montoAFinanciar),
        topeMontoRiesgo,
      )
    : null;
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
  const submissionTransition =
    resolvedSolicitud.estadoActual.code === "CargaVendedor"
      ? workflowTransitions.find(
          (transition) => transition.toState.code === "Motor",
        )
      : undefined;
  // Lo unico que exige el backend para enviar a Riesgo es el recibo de sueldo.
  const faltaReciboParaEnviar =
    resolvedSolicitud.estadoActual.code === "CargaVendedor" &&
    !isLoadingAdjuntos &&
    !adjuntosError &&
    recibos.length === 0;
  const irAAdjuntos = () => {
    if (!cambiarVistaTab("solicitud")) return;
    setSolicitanteTab("adjuntos");
    setSolicitanteNavigation((value) => value + 1);
    requestAnimationFrame(() => {
      const target = document.getElementById("solicitud-adjuntos");
      target?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      target?.focus({ preventScroll: true });
    });
  };
  // Con el boton "Enviar a Riesgo" a la vista, el desplegable queda para el resto.
  const accionesDelEstado =
    ACCIONES_DE_ESTADO[resolvedSolicitud.estadoActual.code];
  const transicionPrincipal =
    submissionTransition ??
    (accionesDelEstado
      ? workflowTransitions.find(
          (transition) => transition.actionCode === accionesDelEstado.primaria,
        )
      : undefined);
  const transicionSecundaria = accionesDelEstado?.secundaria
    ? workflowTransitions.find(
        (transition) => transition.actionCode === accionesDelEstado.secundaria,
      )
    : undefined;
  const otrasAcciones = workflowTransitionOptions.filter(
    (option) =>
      option.value !== transicionPrincipal?.id &&
      option.value !== transicionSecundaria?.id,
  );
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
    setCuotaObjetivoTexto(null);
    if (!canEnterEditMode) {
      return;
    }

    const editValues = mapSolicitudCoreToEditableValues(resolvedSolicitud);
    const linea = lineasSimulador.find(
      (linea) => linea.oid === editValues.solicitud.lineaPrestamoLegacyOid,
    );
    if (!amountLocked)
      editValues.solicitud.montoAFinanciar = ajustarMontoTexto(
        editValues.solicitud.montoAFinanciar,
        linea,
      );
    editValues.solicitud.cuotas = ajustarCuotasTexto(
      editValues.solicitud.cuotas,
      linea,
    );
    setEditableValues(editValues);
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
    if (
      amountLocked &&
      (field === "montoAFinanciar" || field === "cuotaResultante")
    )
      return;
    if (field === "cuotaResultante") {
      setCuotaObjetivoTexto(value);
      return;
    }
    if (
      [
        "montoAFinanciar",
        "cuotas",
        "lineaPrestamoLegacyOid",
        "fechaPrimerVencimiento",
      ].includes(field)
    )
      setCuotaObjetivoTexto(null);
    setEditableValues((current) => {
      if (!current) return current;
      const draft = { ...current.solicitud, [field]: value };
      const linea = lineasSimulador.find(
        (linea) => linea.oid === draft.lineaPrestamoLegacyOid,
      );
      if (!amountLocked)
        draft.montoAFinanciar = ajustarMontoTexto(draft.montoAFinanciar, linea);
      draft.cuotas = ajustarCuotasTexto(draft.cuotas, linea);
      return { ...current, solicitud: draft };
    });
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
    if (
      amountLocked &&
      parseMoneyValue(currentValues.solicitud.montoAFinanciar) !==
        Number(resolvedSolicitud.montoAFinanciar)
    ) {
      toast.error(
        "El monto está bloqueado por el préstamo vinculado. Anulalo en Vimarx antes de modificarlo.",
      );
      return;
    }
    if (cuotaObjetivoTexto !== null && !cuotaEdicion.data) {
      toast.error(
        cuotaEdicion.error?.message ??
          "Esperá a que termine el cálculo de la cuota deseada.",
      );
      return;
    }
    toast.dismiss(EDIT_SOLICITUD_ERROR_TOAST_ID);
    toast.dismiss(EDIT_SOLICITUD_SUCCESS_TOAST_ID);

    // CUIT: se valida solo si se cambio (uno viejo mal cargado no bloquea
    // otras ediciones; el backend tambien lo valida cuando se envia).
    const cuitEditado = currentValues.titular.cuit.trim();
    if (
      cuitEditado &&
      cuitEditado !== (resolvedSolicitud.titular.cuit ?? "").trim() &&
      !esCuitValido(cuitEditado)
    ) {
      const mensaje = "El CUIT no es válido: revisá los 11 números.";
      setTitularErrors((current) => ({ ...current, cuit: mensaje }));
      toast.error(mensaje, { id: EDIT_SOLICITUD_ERROR_TOAST_ID });
      return;
    }

    // Solo si se cambiaron las cuotas o la linea: una solicitud que ya venia
    // fuera de rango no tiene que bloquear otras ediciones. Se compara contra
    // la linea elegida; si no esta en la lista no hay limites y no se valida.
    const cuotasCambiaron =
      currentValues.solicitud.cuotas.trim() !==
      String(resolvedSolicitud.cuotas ?? "");
    const lineaCambio =
      currentValues.solicitud.lineaPrestamoLegacyOid !==
      resolvedSolicitud.lineaPrestamoLegacyOid;
    const cuotasError =
      cuotasCambiaron || lineaCambio
        ? getCuotasFueraDeLineaError(
            currentValues.solicitud.cuotas,
            lineasSimulador.find(
              (linea) =>
                linea.oid === currentValues.solicitud.lineaPrestamoLegacyOid,
            ),
          )
        : null;

    if (montoTopeError) {
      toast.error(montoTopeError, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: EDIT_SOLICITUD_CUOTAS_ERROR_TOAST_ID,
      });
      return;
    }

    if (cuotasError) {
      toast.error(cuotasError, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: EDIT_SOLICITUD_CUOTAS_ERROR_TOAST_ID,
      });
      return;
    }

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

  async function handleCreatePrestamoLegacy(convenio?: ConvenioSocioRequest) {
    toast.dismiss(CREATE_PRESTAMO_LEGACY_ERROR_TOAST_ID);
    toast.dismiss(CREATE_PRESTAMO_LEGACY_SUCCESS_TOAST_ID);

    try {
      await createPrestamoLegacyMutation.mutateAsync(convenio);
      setIsGenerarPrestamoModalOpen(false);
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
        duration:
          error instanceof ApiError &&
          error.code === "ConvenioSocioConflictError"
            ? Infinity
            : 3500,
        icon: <CircleAlert className="size-5" />,
        id: CREATE_PRESTAMO_LEGACY_ERROR_TOAST_ID,
      });
    }
  }

  async function handlePreviewAdjunto(adjunto: SolicitudCoreAdjuntoResponse) {
    if (
      canViewCalculadora &&
      adjunto.tipoAdjunto === "Recibo de Sueldo" &&
      adjunto.solicitudId === solicitudId
    ) {
      if (!cambiarVistaTab("evaluacion")) return;
      setReciboView({ solicitudId, selectedId: adjunto.id });
      return;
    }
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
    setSelectedWorkflowTransition(
      transition?.actionCode === "liquidar"
        ? {
            ...transition,
            actionLabel: analysisActionLabel,
            description:
              "El análisis quedará terminado. El destino se comprobará con la firma vigente al confirmar.",
            toState: {
              ...transition.toState,
              name: documentReview.data?.signature?.approved
                ? "Para transferir"
                : "Revisión de firma",
            },
          }
        : transition,
    );
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
    <div className="h-full min-h-0 p-1 md:p-3">
      <article
        data-header-expanded={headerExpanded}
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
      >
        <div id="solicitud-encabezado-completo" className="contents">
          {/* Ficha: quien pide y en que etapa esta, que se pide, pestanas y acciones. */}
          <CabeceraSolicitudEnBarra
            accionPrincipal={
              canChangeState &&
              (transicionPrincipal || transicionSecundaria) ? (
                <div className="flex items-center gap-2">
                  {transicionSecundaria ? (
                    <Button
                      aria-label={
                        ETIQUETA_DE_ACCION[transicionSecundaria.actionCode] ??
                        transicionSecundaria.actionLabel
                      }
                      className="h-10 rounded-md border border-white/30 bg-transparent px-3 font-semibold text-white hover:bg-white/10 sm:px-4"
                      disabled={
                        isLoadingWorkflowTransitions ||
                        executeWorkflowTransitionMutation.isPending ||
                        transicionSecundaria.blockedReason !== null
                      }
                      onClick={() =>
                        handleWorkflowTransitionChange(transicionSecundaria.id)
                      }
                      title={transicionSecundaria.blockedReason ?? undefined}
                      type="button"
                    >
                      <Undo2 className="size-4" />
                      <span className="hidden sm:inline">
                        {ETIQUETA_DE_ACCION[transicionSecundaria.actionCode] ??
                          transicionSecundaria.actionLabel}
                      </span>
                    </Button>
                  ) : null}
                  {transicionPrincipal ? (
                    <Button
                      aria-label={
                        ETIQUETA_DE_ACCION[transicionPrincipal.actionCode] ??
                        transicionPrincipal.actionLabel
                      }
                      className="h-10 rounded-md bg-verde px-3 font-semibold text-white hover:bg-verde/90 sm:px-5"
                      disabled={
                        isLoadingWorkflowTransitions ||
                        workflowTransitionSelectorErrorMessage !== null ||
                        executeWorkflowTransitionMutation.isPending ||
                        transicionPrincipal.blockedReason !== null ||
                        (transicionPrincipal === submissionTransition &&
                          faltaReciboParaEnviar)
                      }
                      onClick={() =>
                        handleWorkflowTransitionChange(transicionPrincipal.id)
                      }
                      title={
                        transicionPrincipal.blockedReason ??
                        (transicionPrincipal === submissionTransition &&
                        faltaReciboParaEnviar
                          ? "Falta el recibo de sueldo."
                          : undefined)
                      }
                      type="button"
                    >
                      {transicionPrincipal === submissionTransition ? (
                        <Send className="size-4" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      <span className="hidden sm:inline">
                        {ETIQUETA_DE_ACCION[transicionPrincipal.actionCode] ??
                          transicionPrincipal.actionLabel}
                      </span>
                    </Button>
                  ) : null}
                </div>
              ) : null
            }
            destino={topbarSlot}
            aviso={
              faltaReciboParaEnviar ? (
                <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-amber-200">
                  <CircleAlert className="size-3.5" />
                  Falta el recibo de sueldo.
                  <button
                    className="font-semibold underline underline-offset-2 hover:no-underline"
                    onClick={irAAdjuntos}
                    type="button"
                  >
                    Adjuntarlo
                  </button>
                </p>
              ) : submissionTransition?.blockedReason ? (
                <p className="text-xs font-medium text-amber-200">
                  {submissionTransition.blockedReason}
                </p>
              ) : null
            }
            estado={resolvedSolicitud.estadoActual}
            nroSolicitud={resolvedSolicitud.nroSolicitud ?? null}
            estadoDesde={
              // Ultimo cambio de estado del historial (si no hay, la creacion).
              workflowHistory.reduce<string | null>(
                (ultimo, item) =>
                  !ultimo || item.changedAt > ultimo ? item.changedAt : ultimo,
                null,
              ) ?? resolvedSolicitud.createdAt
            }
            prestamo={
              !resolvedSolicitud.legacyOid
                ? null
                : canViewPrestamoGenerado && nroCuentaPrestamo
                  ? `Préstamo Nº ${nroCuentaPrestamo}`
                  : "Préstamo generado"
            }
            titular={resolvedSolicitud.titular}
          />
          <CabeceraSolicitud
            acciones={
              <>
                {canViewCalculadora ? (
                  <nav
                    aria-label="Vistas de la solicitud"
                    className="flex gap-x-4"
                  >
                    {canViewCalculadora &&
                      SOLICITUD_DETAIL_VISTA_TABS.map((tab) => {
                        const isActive = tab.value === vistaTab;

                        return (
                          <button
                            className={`border-b-2 px-0 py-2 text-sm font-medium transition ${
                              isActive
                                ? "border-primary text-primary"
                                : "border-transparent text-foreground-secondary hover:text-foreground"
                            }`}
                            key={tab.value}
                            onClick={() => cambiarVistaTab(tab.value)}
                            type="button"
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                  </nav>
                ) : null}
                <SolicitudDetailToolbar
                  embedded
                  analysisAction={
                    canChangeState && analysisTransition
                      ? {
                          label: analysisActionLabel,
                          onClick: () =>
                            handleWorkflowTransitionChange(
                              analysisTransition.id,
                            ),
                          disabled:
                            isEditing ||
                            isLoadingWorkflowTransitions ||
                            executeWorkflowTransitionMutation.isPending ||
                            Boolean(analysisBlockedReason),
                          disabledReason: isEditing
                            ? "Guardá los cambios antes de terminar el análisis."
                            : (analysisBlockedReason ?? undefined),
                        }
                      : undefined
                  }
                  canEdit={canEnterEditMode}
                  isCreatePrestamoLegacyPending={
                    createPrestamoLegacyMutation.isPending ||
                    linkedLoan.isError ||
                    linkedLoan.data?.status === "unavailable"
                  }
                  isEditing={isEditing}
                  isSaving={patchSolicitudCoreMutation.isPending}
                  onCancelEdit={handleCancelEditing}
                  isSaveDisabled={
                    patchSolicitudCoreMutation.isPending ||
                    (isEditing &&
                      cuotaObjetivoTexto !== null &&
                      !cuotaEdicion.data) ||
                    Boolean(montoTopeError) ||
                    (isEditing
                      ? !hasEditableSolicitudFields
                      : !canEnterEditMode)
                  }
                  isPrestamoLegacyGenerado={Boolean(
                    resolvedSolicitud.legacyOid,
                  )}
                  onCreatePrestamoLegacy={
                    canCreateSocio(currentUser) &&
                    linkedLoan.data?.status !== "cancelled" &&
                    resolvedSolicitud.estadoActual.code === "Confirmada" &&
                    !resolvedSolicitud.legacyOid
                      ? () => setIsGenerarPrestamoModalOpen(true)
                      : undefined
                  }
                  onCreateSocio={
                    canCreateSocio(currentUser) && !esSocio
                      ? () => setIsCreateSocioModalOpen(true)
                      : undefined
                  }
                  onOpenSimulador={() => setIsSimuladorOpen(true)}
                  onPreloadSimulador={loadSimuladorPrestamoModal}
                  onSave={handleSaveToolbarAction}
                  onStartEdit={handleStartEditing}
                  attachmentsAction={{
                    count:
                      isLoadingAdjuntos || adjuntosError
                        ? undefined
                        : adjuntos.length,
                    onClick: irAAdjuntos,
                  }}
                  transitionControl={
                    !headerExpanded &&
                    otrasAcciones.length === 0 &&
                    !isLoadingWorkflowTransitions &&
                    !workflowTransitionSelectorErrorMessage ? undefined : (
                      <StyledSelect
                        className="!h-7 !min-h-7 rounded-[min(var(--radius-md),12px)] !px-2.5 !py-0 text-[0.8rem] leading-none"
                        disabled={
                          !canChangeState ||
                          isLoadingWorkflowTransitions ||
                          workflowTransitionSelectorErrorMessage !== null ||
                          executeWorkflowTransitionMutation.isPending ||
                          otrasAcciones.length === 0
                        }
                        onChange={handleWorkflowTransitionChange}
                        options={otrasAcciones}
                        placeholder={
                          transicionPrincipal && otrasAcciones.length > 0
                            ? "Otras acciones"
                            : workflowTransitionPlaceholder
                        }
                        value={selectedWorkflowTransition?.id ?? ""}
                      />
                    )
                  }
                />
              </>
            }
          />
        </div>
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

        {!canViewCalculadora || vistaTab === "solicitud" ? (
          <div
            data-testid="solicitud-reading-area"
            className="min-h-40 flex-1 space-y-3 overflow-y-auto p-3 pb-8 md:p-4 md:pb-10"
          >
            <LinkedLoanStatusBanner
              canRecover={currentUser?.isSystemAdmin === true}
              editing={isEditing}
              cuenta={
                resolvedSolicitud.legacyOid && nroCuentaPrestamo
                  ? {
                      loanId: String(resolvedSolicitud.legacyOid),
                      nroCuenta: nroCuentaPrestamo,
                    }
                  : null
              }
              solicitudId={solicitudId}
              data={linkedLoan.data}
              loading={linkedLoan.isPending}
              failed={linkedLoan.isError}
              retry={() => void linkedLoan.refetch()}
              onRecovered={() =>
                Promise.all([refetchDetail(), linkedLoan.refetch()])
              }
            />
            {resolvedSolicitud.legacyOid && (
              <div className="border-b border-border px-4 pb-3">
                <ControlledLoanReplacementControl
                  solicitudId={solicitudId}
                  updatedAt={resolvedSolicitud.updatedAt}
                  isEditing={isEditing}
                />
              </div>
            )}

            <AdministrativeStateControl
              key={`admin-state:${solicitudId}`}
              solicitudId={solicitudId}
              updatedAt={resolvedSolicitud.updatedAt}
              isEditing={isEditing}
            />

            {["Transferir", "Pagada"].includes(
              resolvedSolicitud.estadoActual.code,
            ) &&
            (currentUser?.isSystemAdmin ||
              ["TESORERIA", "RIESGO"].includes(
                currentUser?.workflowOwner?.code ?? "",
              )) ? (
              <ExternalPaymentControl
                key={`external-payment:${solicitudId}`}
                solicitudId={solicitudId}
                isPaid={resolvedSolicitud.estadoActual.code === "Pagada"}
              />
            ) : null}
            <DetalleLectura
              prestamoEditable={
                isEditing ? (
                  <SolicitudSection
                    ficha
                    cuotaCalculoMensaje={
                      cuotaObjetivoTexto !== null &&
                      parseMoneyValue(cuotaObjetivoTexto) <= 0
                        ? "Ingresá una cuota mayor a cero."
                        : cuotaEdicion.isPending
                          ? "Calculando..."
                          : cuotaEdicion.error?.message
                    }
                    assignmentOptions={assignmentAgentOptions}
                    assignmentValue={selectedAssignmentValue}
                    assignmentValueLabel={assignmentValueLabel}
                    isFieldEditableByKey={isSolicitudFieldEditable}
                    isEditing={isEditing}
                    isExecutiveAssignmentDisabled={!canManageAssignment}
                    montoTopeError={montoTopeError}
                    mostrarEjecutivo={!isVendedor(currentUser)}
                    lineas={lineasSimulador}
                    onAssignmentChange={setSelectedAssignmentValue}
                    onBooleanChange={updateSolicitudBooleanField}
                    onChange={updateSolicitudField}
                    readonlyAppearanceStyle={readonlyAppearanceStyle}
                    solicitud={resolvedSolicitud}
                    ultimaNovedad={ultimaNovedad}
                    values={{
                      ...currentValues.solicitud,
                      montoAFinanciar:
                        amountLocked || cuotaObjetivoTexto !== null
                          ? currentValues.solicitud.montoAFinanciar
                          : ajustarMontoTexto(
                              currentValues.solicitud.montoAFinanciar,
                              lineaEdicion,
                            ),
                      cuotas: ajustarCuotasTexto(
                        currentValues.solicitud.cuotas,
                        lineaEdicion,
                      ),
                      cuotaResultante: isEditing
                        ? cuotaEdicion.data
                          ? formatDecimalMoneyValue(
                              cuotaEdicion.data.cuotaResultante,
                            )
                          : (cuotaObjetivoTexto ?? "")
                        : currentValues.solicitud.cuotaResultante,
                    }}
                  />
                ) : undefined
              }
              titularEditable={
                isEditing ? (
                  <TitularFields
                    datosLaborales={resolvedSolicitud.datosLaborales}
                    datosLaboralesValues={currentValues.datosLaborales}
                    errors={titularErrors}
                    ficha
                    isEditing
                    isFieldEditableByKey={isSolicitudFieldEditable}
                    onBooleanChange={updateTitularBooleanField}
                    onChange={updateTitularField}
                    onDatosLaboralesChange={updateDatosLaboralesField}
                    readonlyAppearanceStyle={readonlyAppearanceStyle}
                    titular={resolvedSolicitud.titular}
                    values={currentValues.titular}
                  />
                ) : undefined
              }
              situacionSocio={
                <SituacionDelSocio
                  canViewDetalle={
                    Boolean(currentUser) &&
                    canViewPrestamosDelSocio(currentUser)
                  }
                  nroSocio={resolvedSolicitud.titular.nroSocio}
                  onVerPrestamos={() => {
                    if (!cambiarVistaTab("solicitud")) return;
                    setSolicitanteTab("prestamos");
                    setSolicitanteNavigation((value) => value + 1);
                    requestAnimationFrame(() => {
                      const target = document.getElementById(
                        "solicitante-prestamos",
                      );
                      target?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                      target?.focus({ preventScroll: true });
                    });
                  }}
                  revision={JSON.stringify([
                    resolvedSolicitud.titular.nroDocumento,
                    resolvedSolicitud.titular.tipoDocumento,
                    resolvedSolicitud.lineaPrestamoLegacyOid,
                  ])}
                  solicitudId={resolvedSolicitud.id}
                />
              }
              ejecutivo={
                isVendedor(currentUser)
                  ? undefined
                  : (resolvedSolicitud.assignedToUser?.fullName ?? null)
              }
              firmaLegajo={
                verFirmaLegajo ? (
                  <DocumentReviewPanel
                    solicitudId={solicitudId}
                    editing={false}
                  />
                ) : null
              }
              solicitud={resolvedSolicitud}
            />
            <SolicitanteSection
              key={`${resolvedSolicitud.id}:${solicitanteNavigation}`}
              activeTab={solicitanteTab}
              adjuntos={adjuntos}
              canCreateAdicional={isEditing && canUploadAdjuntos}
              canCreateAdjunto={canUploadAdjuntos}
              canDeleteAdjunto={isEditing && canDeleteAdjuntos}
              canDownloadAdjunto={canDownloadAdjuntos}
              canCreateCancelaciones={canCreateCancelaciones}
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
              onEditAdjunto={
                isEditing && canDeleteAdjuntos
                  ? handleOpenEditAdjunto
                  : undefined
              }
              onGarantiaCreate={handleGarantiaCreate}
              onNewAdjuntosLote={handleAddAdjuntosLote}
              onPreviewAdjunto={handlePreviewAdjunto}
              previewingAdjuntoId={previewingAdjuntoId}
              onGarantiaEdit={handleGarantiaEdit}
              onTabChange={setSolicitanteTab}
              onTitularBooleanChange={updateTitularBooleanField}
              onTitularChange={updateTitularField}
              readonlyAppearanceStyle={readonlyAppearanceStyle}
              ocultarCancelaciones={isVendedor(currentUser)}
              soloComplementos
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

        {canViewCalculadora && vistaTab === "credixsa" ? (
          <div className="min-h-40 flex-1 overflow-y-auto">
            <CredixsaInformeSection
              isActive={vistaTab === "credixsa"}
              solicitudId={solicitudId}
            />
          </div>
        ) : null}

        {canViewCalculadora && vistaTab === "evaluacion" ? (
          <EvaluacionRecibosView
            key={solicitudId}
            solicitudId={solicitudId}
            recibos={recibos}
            open={visorRecibosOpen}
            selectedId={visorRecibosOpen ? reciboView.selectedId : null}
            onOpen={() =>
              setReciboView({
                solicitudId,
                selectedId: recibos[0]?.id ?? null,
              })
            }
            onClose={() => setReciboView(null)}
            onSelect={(selectedId) =>
              setReciboView({ solicitudId, selectedId })
            }
            loading={isLoadingAdjuntos}
            error={
              adjuntosError
                ? "No se pudo obtener el listado de recibos de sueldo."
                : null
            }
          >
            <Suspense
              fallback={
                <SolicitudesContentLoader label="Cargando calculadora..." />
              }
            >
              <CalculadoraMutualSheet
                className="flex-1 min-w-0"
                onCambiosSinGuardarChange={setEvaluacionConCambios}
                puedeGuardar={canGuardarEvaluacion}
                source={{ kind: "embedded", solicitudId }}
              />
            </Suspense>
          </EvaluacionRecibosView>
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
              isLoadingLineas={isLoadingLineasSimulador}
              solicitudId={solicitudId}
              onLimitsAdjusted={() => {
                void queryClient.invalidateQueries({
                  queryKey:
                    solicitudesCoreQueryKeys.lineasPrestamo(solicitudId),
                });
              }}
              defaultLineaOid={
                resolvedSolicitud.lineaPrestamoLegacyOid ?? undefined
              }
              valoresIniciales={{
                cuotas: resolvedSolicitud.cuotas ?? null,
                montoAFinanciar:
                  resolvedSolicitud.montoAFinanciar === null ||
                  resolvedSolicitud.montoAFinanciar === undefined
                    ? null
                    : Number(resolvedSolicitud.montoAFinanciar),
              }}
              lineas={lineasSimulador}
              onApply={
                canEnterEditMode
                  ? (valores) => {
                      if (
                        amountLocked &&
                        parseMoneyValue(valores.montoAFinanciar) !==
                          Number(resolvedSolicitud.montoAFinanciar)
                      ) {
                        toast.error(
                          "El monto está bloqueado. Anulá el préstamo en Vimarx antes de aplicar otro monto.",
                        );
                        return;
                      }
                      // El simulador se abre desde la barra aunque la solicitud
                      // no este en edicion. Antes, aplicar en ese caso descartaba
                      // los valores sin avisar; ahora entra en edicion con los
                      // valores cargados, para revisarlos y guardar.
                      if (!isEditing) {
                        handleStartEditing();
                      }

                      setCuotaObjetivoTexto(null);
                      setEditableValues((current) => {
                        const base =
                          current ??
                          mapSolicitudCoreToEditableValues(resolvedSolicitud);

                        return {
                          ...base,
                          solicitud: {
                            ...base.solicitud,
                            cuotaResultante: valores.cuotaResultante,
                            cuotas: valores.cuotas,
                            fechaPrimerVencimiento:
                              valores.fechaPrimerVencimiento,
                            montoAFinanciar: valores.montoAFinanciar,
                          },
                        };
                      });
                      setIsSimuladorOpen(false);
                    }
                  : undefined
              }
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
          initialValues={buildSocioPrefillFromTitular(
            resolvedSolicitud.titular,
          )}
          isSaving={createSocioMutation.isPending}
          onOpenChange={setIsCreateSocioModalOpen}
          onSubmit={handleCreateSocio}
          open={isCreateSocioModalOpen}
          socio={null}
        />
        <GenerarPrestamoDialog
          condicionesKey={JSON.stringify([
            resolvedSolicitud.lineaPrestamoLegacyOid,
            resolvedSolicitud.montoAFinanciar,
            resolvedSolicitud.cuotas,
            resolvedSolicitud.titular,
          ])}
          cuotas={resolvedSolicitud.cuotas}
          isPending={createPrestamoLegacyMutation.isPending}
          lineaPrestamoDescripcion={resolvedSolicitud.lineaPrestamoDescripcion}
          montoAFinanciar={resolvedSolicitud.montoAFinanciar}
          onConfirm={(convenio) => void handleCreatePrestamoLegacy(convenio)}
          onOpenChange={setIsGenerarPrestamoModalOpen}
          open={isGenerarPrestamoModalOpen}
          solicitudId={solicitudId}
        />
      </article>
    </div>
  );
}
