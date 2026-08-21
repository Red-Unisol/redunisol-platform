import { lazy, Suspense, useEffect, useState } from "react";
import { CircleAlert, CircleCheckBig } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { lookupSocioByDocumento } from "@/modules/socios/services/socios-api";
import type { Socio } from "@/modules/socios/types";
import { SolicitudWorkflowActionDialog } from "@/modules/solicitudes-core/components/solicitud-workflow-action-dialog";
import { useExecuteSolicitudCoreTransitionMutation } from "@/modules/solicitudes-core/hooks/use-execute-solicitud-core-transition-mutation";
import { useSolicitudCoreTransitionsQuery } from "@/modules/solicitudes-core/hooks/use-solicitud-core-transitions-query";
import { parseMoneyValue } from "@/shared/utils/money-format";
import { useCreateSolicitudCoreMutation } from "@/modules/solicitudes-editor/hooks/use-create-solicitud-core-mutation";
import { mapNuevaSolicitudFormToCreateSolicitudCoreRequest } from "@/modules/solicitudes-editor/utils/solicitud-core-mappers";
import {
  listSolicitudCoreAdjuntos,
  uploadSolicitudCoreAdjuntosLote,
} from "@/modules/solicitudes-core/services/solicitudes-core-api";
import type {
  CreateSolicitudCoreGarantiaRequest,
  ExecuteWorkflowTransitionRequest,
  PendingSolicitudCoreAdjunto,
  SolicitudCoreAdjuntoResponse,
  UploadSolicitudCoreAdjuntoRequest,
  WorkflowTransition,
} from "@/modules/solicitudes/types/solicitudes-core";
import { loadSimuladorPrestamoModal } from "@/modules/solicitudes-shared/utils/load-simulador-prestamo-modal";
import { prefetchWhenIdle } from "@/modules/solicitudes-shared/utils/prefetch-when-idle";
import { normalizeSolicitudNumber } from "@/modules/solicitudes/utils/solicitud-detail-navigation";
import { ApiError } from "@/shared/services/http/api-error";
import { ModalLoadingOverlay } from "@/shared/components/ui/modal-loading-overlay";

import type { AdjuntoLoteItem } from "../components/AdjuntosLoteModal";
import { NuevaSolicitudView } from "../components/NuevaSolicitudView";
import { SolicitudDetailView } from "../components/SolicitudDetailView";
import { useLineasPrestamo } from "../hooks/useLineasPrestamo";
import { useSolicitudDetailHydration } from "../hooks/useSolicitudDetailHydration";
import { useSolicitudEditorForm } from "../hooks/useSolicitudEditorForm";
import { useSolicitudEditorNavigation } from "../hooks/useSolicitudEditorNavigation";
import type {
  DatosPersonalesTab,
  NuevaSolicitudFormValues,
  NuevaSolicitudTab,
  SolicitanteTab,
} from "../types";

const SimuladorPrestamoModal = lazy(() =>
  loadSimuladorPrestamoModal().then((module) => ({
    default: module.SimuladorPrestamoModal,
  })),
);

const CREATE_SOLICITUD_ERROR_TOAST_ID = "create-solicitud-core-error";
const CREATE_SOLICITUD_SUCCESS_TOAST_ID = "create-solicitud-core-success";
const LOOKUP_SOCIO_ERROR_TOAST_ID = "lookup-socio-error";
const LOOKUP_SOCIO_NOTICE_TOAST_ID = "lookup-socio-notice";
const UPLOAD_ADJUNTO_ERROR_TOAST_ID = "upload-solicitud-core-adjunto-error";
const UPLOAD_ADJUNTO_SUCCESS_TOAST_ID = "upload-solicitud-core-adjunto-success";
const WORKFLOW_TRANSITION_ERROR_TOAST_ID =
  "execute-solicitud-core-transition-error";
const WORKFLOW_TRANSITION_SUCCESS_TOAST_ID =
  "execute-solicitud-core-transition-success";
const FIRST_SUBMISSION_TRANSITION_LABEL = "Motor -> Riesgo";

export type SolicitudEditorVariant = "detail" | "new";

type SolicitudEditorPageProps = {
  variant: SolicitudEditorVariant;
};

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

export function SolicitudEditorPage({ variant }: SolicitudEditorPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oid = searchParams.get("oid")?.trim() ?? "";
  const origen = searchParams.get("origen");
  const nroSolicitudParam =
    normalizeSolicitudNumber(searchParams.get("nroSolicitud")) ?? "";
  const isDetailRoute = variant === "detail";
  const [isSimuladorOpen, setIsSimuladorOpen] = useState(false);
  const [createdSolicitudId, setCreatedSolicitudId] = useState<string | null>(
    null,
  );
  const [selectedWorkflowTransition, setSelectedWorkflowTransition] =
    useState<WorkflowTransition | null>(null);
  const [adjuntos, setAdjuntos] = useState<SolicitudCoreAdjuntoResponse[]>([]);
  const [pendingAdjuntos, setPendingAdjuntos] = useState<
    PendingSolicitudCoreAdjunto[]
  >([]);
  const [garantias, setGarantias] = useState<
    CreateSolicitudCoreGarantiaRequest[]
  >([]);
  const [isUploadingAdjunto, setIsUploadingAdjunto] = useState(false);
  const [nuevaSolicitudTab, setNuevaSolicitudTab] =
    useState<NuevaSolicitudTab>("titular");
  const [datosPersonalesTab, setDatosPersonalesTab] =
    useState<DatosPersonalesTab>("datosPersonales");
  const [solicitanteTab, setSolicitanteTab] =
    useState<SolicitanteTab>("solicitante");
  const { isLoadingLineas, lineas, setLineas } =
    useLineasPrestamo(isDetailRoute);
  const createSolicitudCoreMutation = useCreateSolicitudCoreMutation();
  const {
    data: workflowTransitions = [],
    error: workflowTransitionsError,
    isLoading: isLoadingWorkflowTransitions,
  } = useSolicitudCoreTransitionsQuery(createdSolicitudId ?? "", {
    enabled: createdSolicitudId !== null,
  });
  const executeWorkflowTransitionMutation =
    useExecuteSolicitudCoreTransitionMutation(createdSolicitudId ?? "");
  const {
    clearErrors,
    control,
    currentEstado,
    errors,
    estadoCivilOptions,
    getValues,
    handleSubmit,
    register,
    reset,
    selectedLinea,
    setError,
    setValue,
    sexoConyugeOptions,
    sexoOptions,
  } = useSolicitudEditorForm(lineas);
  const { detalleNroSolicitud, isLoadingLegacyData, legacyNotice } =
    useSolicitudDetailHydration({
      isDetailRoute,
      navigate,
      nroSolicitudParam,
      oid,
      reset,
      searchParams,
      setLineas,
    });
  const { detailTitle, originPath } = useSolicitudEditorNavigation({
    detalleNroSolicitud,
    isDetailRoute,
    origen,
  });

  useEffect(() => prefetchWhenIdle(loadSimuladorPrestamoModal), []);

  async function onCreateSolicitud() {
    const values = getValues();

    clearErrors(REQUIRED_FIELDS.map(({ name }) => name));

    const invalid = REQUIRED_FIELDS.filter(({ name, validate }) => {
      const value = String(values[name] ?? "").trim();
      if (!value) return true;
      return validate ? !validate(value) : false;
    });

    if (invalid.length > 0) {
      invalid.forEach(({ name, label }) => {
        const isEmpty = !String(values[name] ?? "").trim();
        setError(name, {
          type: isEmpty ? "required" : "validate",
          message: isEmpty ? `${label} es requerido` : `${label} es inválido`,
        });
      });
      return;
    }

    toast.dismiss(CREATE_SOLICITUD_ERROR_TOAST_ID);
    toast.dismiss(CREATE_SOLICITUD_SUCCESS_TOAST_ID);

    try {
      const payload = mapNuevaSolicitudFormToCreateSolicitudCoreRequest(
        getValues(),
        {
          garantias,
        },
      );
      const createdSolicitud =
        await createSolicitudCoreMutation.mutateAsync(payload);
      setCreatedSolicitudId(createdSolicitud.id);
      setAdjuntos([]);
      setIsUploadingAdjunto(pendingAdjuntos.length > 0);

      if (pendingAdjuntos.length > 0) {
        try {
          await uploadSolicitudCoreAdjuntosLote(
            createdSolicitud.id,
            pendingAdjuntos.map((pendingAdjunto) => ({
              adicional: pendingAdjunto.adicional,
              comentario: pendingAdjunto.comentario,
              descripcion: pendingAdjunto.descripcion,
              file: pendingAdjunto.file,
              nroDocumento: pendingAdjunto.nroDocumento,
              restringido: pendingAdjunto.restringido,
              tipoAdjunto: pendingAdjunto.tipoAdjunto ?? "",
            })),
          );
          await refreshAdjuntos(createdSolicitud.id);
          setPendingAdjuntos([]);
        } catch {
          toast.error(
            "La solicitud se guardó, pero los adjuntos no pudieron cargarse. Podés reintentar desde la sección de adjuntos.",
            {
              id: UPLOAD_ADJUNTO_ERROR_TOAST_ID,
              icon: <CircleAlert className="size-5" />,
              duration: Infinity,
            },
          );
        }
      }

      toast.success(`Solicitud creada: ${createdSolicitud.id}`, {
        id: CREATE_SOLICITUD_SUCCESS_TOAST_ID,
        icon: <CircleCheckBig className="size-5" />,
        duration: 3500,
      });
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo crear la solicitud.";

      toast.error(message, {
        id: CREATE_SOLICITUD_ERROR_TOAST_ID,
        icon: <CircleAlert className="size-5" />,
        duration: 3500,
      });
    } finally {
      setIsUploadingAdjunto(false);
    }
  }

  async function refreshAdjuntos(solicitudId: string) {
    const nextAdjuntos = await listSolicitudCoreAdjuntos(solicitudId);
    setAdjuntos(nextAdjuntos);
  }

  const REQUIRED_FIELDS: Array<{
    name: keyof NuevaSolicitudFormValues;
    label: string;
    validate?: (value: string) => boolean;
  }> = [
    { name: "linea", label: "Línea de préstamo" },
    {
      name: "montoAFinanciar",
      label: "Monto a financiar",
      validate: (v) => parseMoneyValue(v) > 0,
    },
    {
      name: "cuotas",
      label: "Cuotas",
      validate: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
    },
    { name: "documento", label: "Tipo de documento" },
    { name: "noDocumento", label: "Nro. de documento" },
    { name: "cuit", label: "CUIT" },
    { name: "apellidoDenominacion", label: "Apellido / Denominación" },
    { name: "nombre", label: "Nombre" },
    { name: "fechaNacimiento", label: "Fecha de nacimiento" },
  ];

  function onEditAdjunto(
    localId: string,
    payload: UploadSolicitudCoreAdjuntoRequest,
  ) {
    setPendingAdjuntos((current) =>
      current.map((adj) =>
        adj.localId === localId ? { ...payload, localId } : adj,
      ),
    );
  }

  function onDeleteAdjunto(localId: string) {
    setPendingAdjuntos((current) =>
      current.filter((adj) => adj.localId !== localId),
    );
  }

  async function onAddAdjuntosLote(items: AdjuntoLoteItem[]) {
    if (!createdSolicitudId) {
      setPendingAdjuntos((currentPendingAdjuntos) => [
        ...currentPendingAdjuntos,
        ...items.map((item) => ({
          file: item.file,
          tipoAdjunto: item.tipoAdjunto,
          localId: crypto.randomUUID(),
        })),
      ]);
      return true;
    }

    toast.dismiss(UPLOAD_ADJUNTO_ERROR_TOAST_ID);
    toast.dismiss(UPLOAD_ADJUNTO_SUCCESS_TOAST_ID);
    setIsUploadingAdjunto(true);

    try {
      await uploadSolicitudCoreAdjuntosLote(createdSolicitudId, items);
      await refreshAdjuntos(createdSolicitudId);

      toast.success(
        items.length === 1
          ? "Adjunto cargado."
          : `${items.length} adjuntos cargados.`,
        {
          id: UPLOAD_ADJUNTO_SUCCESS_TOAST_ID,
          icon: <CircleCheckBig className="size-5" />,
          duration: 3500,
        },
      );
      return true;
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudieron cargar los adjuntos.";

      toast.error(message, {
        id: UPLOAD_ADJUNTO_ERROR_TOAST_ID,
        icon: <CircleAlert className="size-5" />,
        duration: 3500,
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
      return "La solicitud cambió de estado. Se recargaron los datos.";
    }

    if (error instanceof ApiError && error.status === 403) {
      return "No tenés permisos para ejecutar esta acción.";
    }

    if (error instanceof ApiError && error.status === 401) {
      return "La sesión expiró. Iniciá sesión nuevamente.";
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
      toast.error(resolveWorkflowTransitionErrorMessage(error), {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: WORKFLOW_TRANSITION_ERROR_TOAST_ID,
      });

      throw error;
    }
  }

  async function handleConfirmWorkflowTransition(
    payload: ExecuteWorkflowTransitionRequest,
  ) {
    await handleExecuteWorkflowTransition(payload);
    setSelectedWorkflowTransition(null);
  }

  function handleWorkflowTransitionChange(transitionId: string) {
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

  const workflowTransitionOptions = workflowTransitions.map((transition) => ({
    disabled: transition.blockedReason !== null,
    disabledReason: transition.blockedReason ?? undefined,
    label: formatWorkflowTransitionOptionLabel(
      transition,
      createdSolicitudId ? "CargaVendedor" : undefined,
    ),
    value: transition.id,
  }));
  const workflowTransitionErrorText =
    workflowTransitionsError instanceof ApiError ||
    workflowTransitionsError instanceof Error
      ? workflowTransitionsError.message
      : null;
  const workflowTransitionPlaceholder =
    createdSolicitudId === null
      ? "Guardá para habilitar envío"
      : isLoadingWorkflowTransitions
        ? "Cargando acciones..."
        : workflowTransitionErrorText
          ? workflowTransitionErrorText
          : workflowTransitionOptions.length > 0
            ? "Enviar a..."
            : "Sin acciones disponibles";
  const isWorkflowTransitionDisabled =
    createdSolicitudId === null ||
    isLoadingWorkflowTransitions ||
    workflowTransitionErrorText !== null ||
    executeWorkflowTransitionMutation.isPending ||
    workflowTransitionOptions.length === 0;
  const workflowTransitionErrorMessage =
    executeWorkflowTransitionMutation.error instanceof ApiError ||
    executeWorkflowTransitionMutation.error instanceof Error
      ? executeWorkflowTransitionMutation.error.message
      : null;

  function normalizeLookupValue(value: string) {
    return value.replaceAll(/\D/g, "");
  }

  function hydrateTitularFromSocio(socio: Socio) {
    if (socio.tipoPersona === "FISICA") {
      setValue("apellidoDenominacion", socio.apellido, {
        shouldDirty: true,
      });
      setValue("celular", socio.celular ?? "", {
        shouldDirty: true,
      });
      setValue("cuit", socio.cuit, {
        shouldDirty: true,
      });
      setValue("documento", socio.tipoDocumento, {
        shouldDirty: true,
      });
      setValue("email", socio.email ?? "", {
        shouldDirty: true,
      });
      setValue("fechaNacimiento", socio.fechaDeNacimiento, {
        shouldDirty: true,
      });
      setValue("noDocumento", socio.nroDocumento, {
        shouldDirty: true,
      });
      setValue("nombre", socio.nombre, {
        shouldDirty: true,
      });
      setValue("sexo", socio.sexo, {
        shouldDirty: true,
      });
      return;
    }

    setValue("apellidoDenominacion", socio.razonSocial, {
      shouldDirty: true,
    });
    setValue("celular", socio.celular ?? "", {
      shouldDirty: true,
    });
    setValue("cuit", socio.cuit, {
      shouldDirty: true,
    });
    setValue("email", socio.email ?? "", {
      shouldDirty: true,
    });
  }

  async function handleLookupTitularByDocumento() {
    toast.dismiss(LOOKUP_SOCIO_ERROR_TOAST_ID);
    toast.dismiss(LOOKUP_SOCIO_NOTICE_TOAST_ID);

    const documentoIngresado = normalizeLookupValue(getValues("noDocumento"));

    if (documentoIngresado.length < 7) {
      return;
    }

    try {
      const response = await lookupSocioByDocumento(
        documentoIngresado,
        getValues("documento") || undefined,
      );

      if (response.match === "none") {
        toast("No se encontró un socio con ese documento.", {
          duration: 2500,
          id: LOOKUP_SOCIO_NOTICE_TOAST_ID,
        });
        return;
      }

      if (response.match === "multiple") {
        toast("Se encontraron múltiples socios, revise la búsqueda.", {
          duration: 3000,
          id: LOOKUP_SOCIO_NOTICE_TOAST_ID,
        });
        return;
      }

      hydrateTitularFromSocio(response.socio);
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo buscar el socio.";

      toast.error(message, {
        duration: 3500,
        icon: <CircleAlert className="size-5" />,
        id: LOOKUP_SOCIO_ERROR_TOAST_ID,
      });
    }
  }

  const simulador = isSimuladorOpen ? (
    <Suspense fallback={<ModalLoadingOverlay label="Cargando simulador..." />}>
      <SimuladorPrestamoModal
        defaultLineaOid={selectedLinea?.oid ?? undefined}
        lineas={lineas}
        onApply={(valores) => {
          setValue("linea", valores.linea, { shouldValidate: true });
          setValue("montoAFinanciar", valores.montoAFinanciar);
          setValue("cuotas", valores.cuotas);
          setValue("cuotaResultante", valores.cuotaResultante);
          setValue("fechaPrimerVencimiento", valores.fechaPrimerVencimiento);
          setIsSimuladorOpen(false);
        }}
        onOpenChange={setIsSimuladorOpen}
        open={isSimuladorOpen}
      />
    </Suspense>
  ) : null;

  if (!isDetailRoute) {
    return (
      <>
        <NuevaSolicitudView
          adjuntos={adjuntos}
          control={control}
          errors={errors}
          garantias={garantias}
          isLoadingLineas={isLoadingLineas}
          isSaving={createSolicitudCoreMutation.isPending}
          isUploadingAdjunto={isUploadingAdjunto}
          lineas={lineas}
          onAddAdjuntosLote={onAddAdjuntosLote}
          onEditAdjunto={onEditAdjunto}
          onDeleteAdjunto={onDeleteAdjunto}
          onAddGarantia={(garantia) =>
            setGarantias((currentGarantias) => [...currentGarantias, garantia])
          }
          onBack={() => navigate(originPath)}
          onLookupTitularByDocumento={() =>
            void handleLookupTitularByDocumento()
          }
          onOpenSimulador={() => setIsSimuladorOpen(true)}
          onWorkflowTransitionChange={handleWorkflowTransitionChange}
          pendingAdjuntos={pendingAdjuntos}
          onSave={() => void handleSubmit(onCreateSolicitud)()}
          onTabChange={setNuevaSolicitudTab}
          register={register}
          selectedLinea={selectedLinea}
          selectedWorkflowTransitionId={selectedWorkflowTransition?.id ?? ""}
          tab={nuevaSolicitudTab}
          workflowTransitionOptions={workflowTransitionOptions}
          workflowTransitionPlaceholder={workflowTransitionPlaceholder}
          isWorkflowTransitionDisabled={isWorkflowTransitionDisabled}
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
        />
        {simulador}
      </>
    );
  }

  return (
    <>
      <SolicitudDetailView
        control={control}
        currentEstado={currentEstado}
        datosPersonalesTab={datosPersonalesTab}
        detailTitle={detailTitle}
        estadoCivilOptions={estadoCivilOptions}
        errors={errors}
        isLoadingLegacyData={isLoadingLegacyData}
        isLoadingLineas={isLoadingLineas}
        legacyNotice={legacyNotice}
        lineas={lineas}
        onBack={() => navigate(originPath)}
        onDatosPersonalesTabChange={setDatosPersonalesTab}
        onOpenSimulador={() => setIsSimuladorOpen(true)}
        onPreloadSimulador={loadSimuladorPrestamoModal}
        onSolicitanteTabChange={setSolicitanteTab}
        register={register}
        selectedLinea={selectedLinea}
        sexoConyugeOptions={sexoConyugeOptions}
        sexoOptions={sexoOptions}
        solicitanteTab={solicitanteTab}
      />
      {simulador}
    </>
  );
}

export function SolicitudesNuevaPage() {
  return <SolicitudEditorPage variant="new" />;
}
