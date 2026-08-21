export type VendedorDashboardFilters = {
  fechaDesde: string;
  fechaHasta: string;
  linea: string;
};

function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstDayOfCurrentMonth() {
  const now = new Date();
  return toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
}

function today() {
  return toIsoDate(new Date());
}

export const DEFAULT_VENDEDOR_DASHBOARD_FILTERS: VendedorDashboardFilters = {
  fechaDesde: firstDayOfCurrentMonth(),
  fechaHasta: today(),
  linea: "",
};

export type VendedorDashboardStats = {
  kpis: {
    montoLiquidado: number;
    aprobadoSinLiquidar: number;
    solicitudesIniciadas: number;
    tiempoPromedioDiasLiquidacion: number | null;
  };
  evolucionMensual: Array<{ periodo: string; monto: number }>;
  solicitudesPorEstado: Array<{ estado: string; count: number }>;
  funnel: Array<{ estado: string; count: number }>;
  montosPorLinea: Array<{ linea: string; monto: number; count: number }>;
  pendientes: Array<{
    id: string;
    titular: string;
    linea: string;
    estado: string;
    monto: number;
    diasActiva: number;
  }>;
  filterOptions: {
    lineas: string[];
  };
};

export type AnalistaDashboardFilters = {
  conRetrabajo: "" | "con" | "sin";
  estado: string;
  linea: string;
  fechaDesde: string;
  fechaHasta: string;
  umbralDias: number;
  vendedorId: string;
  vista: "mis_casos" | "sin_asignar" | "ambos";
};

export const DEFAULT_ANALISTA_DASHBOARD_FILTERS: AnalistaDashboardFilters = {
  conRetrabajo: "",
  estado: "",
  linea: "",
  fechaDesde: firstDayOfCurrentMonth(),
  fechaHasta: today(),
  umbralDias: 7,
  vendedorId: "",
  vista: "mis_casos",
};

export type AnalistaDashboardStats = {
  kpis: {
    asignadosAMi: number;
    casosConRevision: number;
    detenidosMasDeNDias: number;
    sinAsignarEnMiArea: number;
    tasaDeRechazoPeriodo: number | null;
  };
  backlogPorEstado: Array<{ estado: string; count: number }>;
  retrabajoYRevisiones: {
    conRetrabajo: number;
    promedioRevisionesPorCaso: number;
    tresOMasRevisiones: number;
  };
  casosParaTomar: Array<{
    id: string;
    titular: string;
    linea: string;
    vendedor: string;
    diasEnCola: number;
  }>;
  casosConMultiplesRevisiones: Array<{
    id: string;
    titular: string;
    estado: string;
    cantidadRevisiones: number;
  }>;
  transicionesLentas: Array<{
    id: string;
    titular: string;
    estadoActual: string;
    estadoDestinoEsperado: string;
    diasAcumulados: number;
  }>;
  filterOptions: {
    estados: Array<{ code: string; name: string }>;
    lineas: string[];
    vendedores: Array<{ id: string; fullName: string }>;
  };
};

export type AnalistaDashboardStatsV2 = {
  kpis: {
    asignadosAMi: number;
    sinAsignarEnMiArea: number;
    detenidosMasDeNDias: number;
    casosConRevision: number;
  };
  misCasosActivos: Array<{
    id: string;
    titular: string;
    linea: string;
    estado: string;
    turno: "mia" | "otro";
    diasAcumulados: number;
    cantidadRevisiones: number;
    volvioCorregido: boolean;
  }>;
  casosParaTomar: Array<{
    id: string;
    titular: string;
    linea: string;
    vendedor: string;
    diasEnCola: number;
  }>;
  historialTrabajo: Array<{
    solicitudId: string;
    fecha: string;
    titular: string;
    accion: string;
    resultado: string;
  }>;
  filterOptions: {
    estados: Array<{ code: string; name: string }>;
    lineas: string[];
    vendedores: Array<{ id: string; fullName: string }>;
  };
};
