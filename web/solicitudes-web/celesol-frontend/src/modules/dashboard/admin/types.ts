export type DashboardAdminFilters = {
  fechaDesde: string;
  fechaHasta: string;
  linea: string;
  estado: string;
  area: string;
  vendedorId: string;
  asignadoId: string;
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

export const DEFAULT_DASHBOARD_FILTERS: DashboardAdminFilters = {
  fechaDesde: firstDayOfCurrentMonth(),
  fechaHasta: today(),
  linea: "",
  estado: "",
  area: "",
  vendedorId: "",
  asignadoId: "",
};

export type DashboardAdminStats = {
  kpis: {
    creadasPeriodo: number;
    backlogActivo: number;
    sinAsignar: number;
    detenidas7dias: number;
    rechazadas: number;
    desestimadas: number;
    vencidas: number;
    dineroDisponible?: number;
  };
  backlogPorEstado: Array<{ estado: string; count: number }>;
  backlogPorArea: Array<{ area: string; count: number }>;
  rendimientoPorLinea: Array<{ linea: string; count: number }>;
  calidadDatos: {
    sinEjecutivo: number;
  };
  solicitudesAntiguas: Array<{
    id: string;
    titular: string;
    linea: string;
    estado: string;
    diasActiva: number;
  }>;
  solicitudesSinAsignar?: Array<{
    id: string;
    titular: string;
    linea: string;
    estado: string;
    diasActiva: number;
  }>;
  funnelPeriodo: {
    confirmadas: number;
    liquidadas: number;
    verificacionFirma: number;
    transferidas: number;
  };
  filterOptions: {
    vendedores: Array<{ id: string; fullName: string }>;
    estados: Array<{ code: string; name: string }>;
    areas: Array<{ code: string; name: string }>;
    lineas: string[];
  };
};
