import type { LoginResponse } from "../src/modules/auth/services/auth-api";
import type {
  CalculadoraMutualDatos,
  EvaluacionRiesgo,
} from "../src/modules/riesgo/services/riesgo-api";
import type {
  SolicitudCoreAdjuntoResponse,
  SolicitudCoreResponse,
  SolicitudCoreWorkflowHistoryItem,
} from "../src/modules/solicitudes/types/solicitudes-core";
import type { LineaPrestamoPresolicitud } from "../src/modules/solicitudes/types/solicitudes";
import {
  HEADER_DOCUMENT_REVIEW_FIXTURE,
  HEADER_SAMPLE,
  HEADER_SESSION_FIXTURE,
} from "./header-fixtures.ts";
import { SAMPLE_REQUEST } from "./header-sample.ts";

export type ProductionRole = "riesgo" | "admin" | "vendedor";
export type ProductionFixtureOptions = {
  role?: ProductionRole;
  externalPayment?: boolean;
  allowEdit?: boolean;
};

const timestamp = "2026-10-23T20:05:00.000Z";

export function productionSession(
  role: ProductionRole = "riesgo",
): LoginResponse {
  const base = HEADER_SESSION_FIXTURE.user;
  return {
    user: {
      ...base,
      isSystemAdmin: role === "admin",
      workflowOwner: {
        ...base.workflowOwner!,
        code: role === "vendedor" ? "VENDEDORES" : "RIESGO",
        name:
          role === "vendedor" ? "Vendedores de ejemplo" : "Riesgo de ejemplo",
      },
    },
  };
}

export const PRODUCTION_SOLICITUD: SolicitudCoreResponse = {
  id: HEADER_SAMPLE.id,
  legacyOid: HEADER_SAMPLE.loanId,
  nroSolicitud: HEADER_SAMPLE.number,
  nroOperacion: "DEMO-OPERACION-001",
  loanReplacementPending: false,
  assignedToUser: null,
  assignedToUserId: null,
  appearance: { backgroundColor: null, textColor: null },
  capabilities: {
    canView: true,
    canEdit: false,
    canUploadAdjuntos: false,
    canDeleteAdjuntos: false,
    canDownloadAdjuntos: false,
    canCreateCancelaciones: false,
    canManageCancelaciones: false,
    canChangeState: false,
    canViewHistory: true,
    fieldAccess: {
      defaultMode: "readonly",
      editableFields: [],
      editableGroups: [],
    },
  },
  conyuge: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  createdBy: "Operador de ejemplo",
  cuotaResultante: String(SAMPLE_REQUEST.installment),
  cuotas: SAMPLE_REQUEST.cuotas,
  cupoTitular: 1500000,
  datosLaborales: {
    actividadLaboral: "Jubilada",
    antiguedadLaboralMeses: 120,
    descuentosSueldo: 280000,
    domicilioLaboralCalle: null,
    domicilioLaboralLocalidad: null,
    domicilioLaboralNroPuerta: null,
    domicilioLaboralPisoDepto: null,
    empleador: "Organismo de ejemplo",
    fechaIngresoLaboral: "2016-01-01",
    montoRecibo: 1250000,
    relacionLaboral: "Jubilada",
    tarjetas: null,
    vehiculo: null,
    vivienda: "Propia",
  },
  ejecutivoSolicitud: "SOFÍA DEMO",
  linkFirmaDigital: null,
  estadoActual: {
    code: "Pagada",
    id: "demo-estado-pagada",
    name: "Pagada",
    ownerId: "demo-tesoreria",
    owner: {
      code: "TESORERIA",
      id: "demo-tesoreria",
      name: "Tesorería de ejemplo",
    },
  },
  firmaDigitalmente: true,
  garantias: [],
  lineaPrestamoDescripcion: HEADER_SAMPLE.convenio,
  lineaPrestamoLegacyOid: "999",
  fechaPrimerVencimiento: "2026-11-30",
  montoAFinanciar: SAMPLE_REQUEST.amount,
  montoAprobadoRiesgo: SAMPLE_REQUEST.amount,
  motivo: "Solicitud ficticia para revisar la interfaz localmente.",
  observaciones:
    "Datos de demostración. Este entorno no ejecuta operaciones reales.",
  titular: {
    ...HEADER_SAMPLE.titular,
    cbu: null,
    cbuNoHabitual: null,
    celular: null,
    domicilioCalle: "Calle de ejemplo",
    email: "maria@example.invalid",
    estadoCivil: "Soltera",
    fechaNacimiento: "1960-01-01",
    localidad: "Localidad de ejemplo",
    nacionalidad: "Argentina",
    nroPuerta: "100",
    nroSocio: HEADER_SAMPLE.member,
    personaExpuestaPoliticamente: false,
    sexo: "Femenino",
    telefonoFijo: null,
  },
  vendedorSolicitud: "SOFÍA DEMO",
};

const attachmentNames = [
  "DNI frente",
  "DNI dorso",
  "Recibo de Sueldo",
  "Solicitud firmada",
  "Anexo firmado",
  "Comprobante",
];
const attachments: SolicitudCoreAdjuntoResponse[] = attachmentNames.map(
  (name, index) => ({
    adicional: null,
    archivoMimeType: "application/pdf",
    archivoNombre: `documento-ejemplo-${index + 1}.pdf`,
    archivoPath: null,
    archivoSizeBytes: 1024,
    comentario: "Archivo ficticio sin contenido descargable.",
    deleteReason: null,
    deletedAt: null,
    deletedBy: null,
    descripcion: name,
    estadoAdjunto: "Activo",
    id: `demo-adjunto-${index + 1}`,
    nroDocumento: HEADER_SAMPLE.document,
    restringido: false,
    solicitudId: HEADER_SAMPLE.id,
    storageBucket: null,
    tipoAdjunto: name,
    updatedAt: timestamp,
    uploadedAt: timestamp,
    uploadedBy: "demo-operador",
    uploadedByName: "Operador de ejemplo",
  }),
);

const history: SolicitudCoreWorkflowHistoryItem[] = [
  {
    actionCode: "PAGAR",
    actionLabel: "Pago registrado",
    changedAt: timestamp,
    changedBy: "demo-operador",
    changedByFullName: "Operador de ejemplo",
    comentario: "Registro ficticio para la revisión visual.",
    estadoAnterior: {
      code: "Transferir",
      name: "Transferir",
      ownerCode: "TESORERIA",
      ownerName: "Tesorería",
    },
    estadoNuevo: {
      code: "Pagada",
      name: "Pagada",
      ownerCode: "TESORERIA",
      ownerName: "Tesorería",
    },
    id: "demo-historial-001",
    motivo: null,
    solicitudId: HEADER_SAMPLE.id,
  },
];

const lines: LineaPrestamoPresolicitud[] = [
  {
    cantidadMaximaCuotas: 24,
    cantidadMinimaCuotas: 6,
    descripcion: HEADER_SAMPLE.convenio,
    montoMaximo: 1500000,
    montoMinimo: 100000,
    oid: "999",
    tasa: 60,
    vigente: true,
  },
];

const calculationData: CalculadoraMutualDatos = {
  antiguedadLaboral: 120,
  compromisoMensualVigente: 50000,
  convenio: HEADER_SAMPLE.convenio,
  cuitTitular: HEADER_SAMPLE.cuit,
  cuotaResultante: SAMPLE_REQUEST.installment,
  cuotas: SAMPLE_REQUEST.cuotas,
  cupoDisponibleVendedor: 1500000,
  dniTitular: HEADER_SAMPLE.document,
  fechaPrimerVencimiento: "2026-11-30",
  fechaSolicitud: "2026-10-23",
  ingresos: 1250000,
  lineaDescripcion: HEADER_SAMPLE.convenio,
  lineaId: 999,
  montoAFinanciar: SAMPLE_REQUEST.amount,
  nombreCompletoTitular: HEADER_SAMPLE.name,
  nroSolicitud: HEADER_SAMPLE.number,
  rechazosDelMes: 0,
  saldoPrestamosVigentes: 250000,
  situacionSocio: "Socio activo de ejemplo",
  titularNuevo: false,
  vendedor: "SOFÍA DEMO",
};

// A fictional saved workbook exercises the actual Univer renderer and hydration
// without requiring the operational Excel template or any customer information.
const evaluation: EvaluacionRiesgo = {
  guardadaEn: timestamp,
  guardadaPor: { id: "demo-operador", nombre: "Operador de ejemplo" },
  nivelRiesgo: 2,
  snapshot: {
    id: "demo-evaluacion-workbook",
    name: "Evaluación ficticia de UI",
    appVersion: "0.25.1",
    locale: "esES",
    styles: {},
    sheetOrder: ["demo-evaluacion", "demo-datos"],
    sheets: {
      "demo-evaluacion": {
        id: "demo-evaluacion",
        name: "Evaluacion",
        rowCount: 60,
        columnCount: 10,
        defaultColumnWidth: 160,
        defaultRowHeight: 28,
        mergeData: [],
        cellData: {
          0: { 0: { v: "EVALUACIÓN DE EJEMPLO · DATOS FICTICIOS" } },
          2: {
            0: { v: "Titular" },
            1: { f: "=Datos!B16", v: HEADER_SAMPLE.name },
          },
          3: {
            0: { v: "Documento" },
            1: { f: "=Datos!B14", v: HEADER_SAMPLE.document },
          },
          5: {
            0: { v: "Monto solicitado" },
            1: { f: "=Datos!B5", v: SAMPLE_REQUEST.amount },
          },
          6: {
            0: { v: "Cuotas" },
            1: { f: "=Datos!B6", v: SAMPLE_REQUEST.cuotas },
          },
          7: {
            0: { v: "Cuota resultante" },
            1: { f: "=Datos!B7", v: SAMPLE_REQUEST.installment },
          },
          9: {
            0: { v: "Ingreso declarado" },
            1: { f: "=Datos!B26", v: 1250000 },
          },
          11: {
            0: { v: "Convenio" },
            1: { f: "=Datos!B10", v: HEADER_SAMPLE.convenio },
          },
          29: { 0: { v: "Nivel de riesgo de ejemplo" }, 3: { v: 2 } },
        },
      },
      "demo-datos": {
        id: "demo-datos",
        name: "Datos",
        rowCount: 60,
        columnCount: 10,
        defaultColumnWidth: 160,
        defaultRowHeight: 28,
        mergeData: [],
        cellData: { 0: { 0: { v: "DATOS FICTICIOS DE LA SOLICITUD" } } },
      },
    },
    resources: [],
  },
};

export type ProductionFixtureResult =
  | { found: true; body: unknown }
  | { found: false };
export function productionFixture(
  pathname: string,
  options: ProductionFixtureOptions = {},
): ProductionFixtureResult {
  const base = `/solicitudes/${HEADER_SAMPLE.id}`;
  const riskBase = `/api/riesgo/calculadora/core/${HEADER_SAMPLE.id}`;
  let body: unknown;
  if (pathname === "/auth/me") body = productionSession(options.role);
  else if (pathname === "/solicitudes") body = [{ ...PRODUCTION_SOLICITUD, ultimaNovedad: null }];
  else if (pathname === "/api/notifications")
    body = { items: [], unreadCount: 0, total: 0, offset: 0, limit: 8 };
  else if (pathname === base)
    body = options.allowEdit
      ? {
          ...PRODUCTION_SOLICITUD,
          capabilities: {
            ...PRODUCTION_SOLICITUD.capabilities!,
            canEdit: true,
            fieldAccess: {
              defaultMode: "readonly",
              editableFields: ["solicitud.observaciones"],
              editableGroups: [],
            },
          },
        }
      : PRODUCTION_SOLICITUD;
  else if (pathname === `${base}/adjuntos`) body = attachments;
  else if (pathname === `${base}/history`) body = history;
  // The editing scenario exercises save/cancel with notes only. No available
  // simulation lines means entering edit mode cannot trigger a calculation POST.
  else if (pathname === `${base}/lineas-prestamo`)
    body = options.allowEdit ? [] : lines;
  else if (pathname === "/solicitudes/tipos-adjunto")
    body = attachmentNames.map((name) => ({ label: name, value: name }));
  else if (pathname === `${base}/linked-loan-status`)
    body = {
      status: "active",
      currentLoanId: HEADER_SAMPLE.loanId,
      amount: SAMPLE_REQUEST.amount,
      requestedAmount: SAMPLE_REQUEST.amount,
      matchesAmount: true,
      amountEditable: false,
      recovery: null,
    };
  else if (pathname === `${base}/prestamos-socio/${HEADER_SAMPLE.loanId}`)
    body = {
      prestamo: {
        legacyId: HEADER_SAMPLE.loanId,
        nroCuenta: "DEMO-100241",
        cuotas: SAMPLE_REQUEST.cuotas,
        asiento: null,
        cobrador: "Convenio de ejemplo",
        destino: "Ejemplo",
        lineaPrestamoDescripcion: HEADER_SAMPLE.convenio,
        ordenCompra: null,
        tasaInicial: null,
      },
      cuotas: [],
    };
  else if (pathname === `${base}/admin-loan-replacements`)
    body = {
      canAdmin: false,
      canReplace: false,
      canRecover: false,
      blockedReason: null,
      updatedAt: timestamp,
      currentLoanId: HEADER_SAMPLE.loanId,
      amount: SAMPLE_REQUEST.amount,
      cuotas: SAMPLE_REQUEST.cuotas,
      line: HEADER_SAMPLE.convenio,
      operations: [],
    };
  else if (pathname === `${base}/admin-state-correction`)
    body = {
      replacementPending: false,
      canAdmin: false,
      state: "Pagada",
      updatedAt: timestamp,
      loanId: HEADER_SAMPLE.loanId,
      reconciliationRequired: false,
      blockedReason: null,
    };
  else if (pathname === `${base}/pago-externo`)
    body = {
      canRegister: false,
      blockedReason: null,
      reservationPending: false,
      payment: options.externalPayment
        ? {
            id: "demo-pago-001",
            paidOn: "2026-10-23",
            reference: "Pago de ejemplo",
            comment: "Comprobante ficticio para revisar la altura del aviso.",
            adjuntoId: "demo-adjunto-6",
            recordedAt: timestamp,
            recordedBy: "Operador de ejemplo",
          }
        : null,
    };
  else if (pathname === `${base}/document-review`)
    body = {
      ...HEADER_DOCUMENT_REVIEW_FIXTURE,
      analysisReady: true,
      signature: {
        status: "approved",
        completedAttempts: 1,
        lastCompletedAt: timestamp,
        approved: true,
        reason: null,
        link: null,
        cycle: "demo-ciclo-001",
        decisionId: "demo-decision-001",
      },
    };
  else if (pathname === `${base}/credixsa`)
    body = {
      credixsa: {
        ok: true,
        status: "found",
        error: null,
        cacheHit: true,
        cachedAt: timestamp,
        informe: {
          persona: {
            nombre_completo: HEADER_SAMPLE.name,
            documento: HEADER_SAMPLE.document,
            cuit: HEADER_SAMPLE.cuit,
            edad: "66",
            domicilio: "Domicilio de ejemplo",
          },
          bcra: {
            resumen: {
              color: "Normal",
              detalle: "Situación ficticia sin observaciones",
            },
            deuda_vigente_total: "$ 250.000",
          },
          alertas: [],
          quiebras: [],
        },
      },
    };
  else if (pathname === `${riskBase}/datos`) body = calculationData;
  else if (pathname === `${riskBase}/evaluacion`)
    body = { evaluacion: evaluation };
  else return { found: false };
  return { found: true, body };
}
