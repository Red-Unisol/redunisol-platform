// ── Performance Dashboard — Mock Data ────────────────────────────────────────
// All values are placeholder data for demo/design validation.
// To connect real data: replace PERFORMANCE_MOCK with a value returned from
// a query hook (e.g. usePerformanceDashboardQuery) that implements PerformanceData.
// The PerformanceDashboardView component accepts PerformanceData as a prop —
// one import swap is all that's needed.

export interface PerformanceKpis {
  montoSolicitado: number;
  montoEnGestion: number;
  montoEnviadoTesoreria: number;
  moraTotal: number;
  dineroDisponible?: number;
  /** Percentage change vs. previous period (positive = up, negative = down) */
  variacionSolicitado: number;
  variacionGestion: number;
  variacionTesoreria: number;
  variacionMora: number;
}

export interface PerformanceLineaMonto {
  linea: string;
  monto: number;
}

export interface PerformanceVendedorMonto {
  nombre: string;
  monto: number;
}

export interface PerformanceVendedorCantidad {
  nombre: string;
  cantidad: number;
}

export interface PerformancePeriodoPunto {
  periodo: string;
  monto: number;
}

export interface PerformanceResumen {
  lineaTop: string;
  montoTopLinea: number;
  vendedorTopMonto: string;
  montoTopVendedor: number;
  vendedorTopCantidad: string;
  cantidadTopVendedor: number;
}

export interface PerformancePrestamosOtorgados {
  periodo: string;
  cantidad: number;
  monto: number;
}

export interface PerformanceMoraBucket {
  bucket: string;
  monto: number;
  cantidad: number;
}

export interface PerformanceData {
  kpis: PerformanceKpis;
  montosPorLinea: PerformanceLineaMonto[];
  rankingMonto: PerformanceVendedorMonto[];
  rankingCantidad: PerformanceVendedorCantidad[];
  /** Historical monthly series per loan line — used for the area chart */
  historico: Record<string, PerformancePeriodoPunto[]>;
  /** Ordered list of loan line names — matches keys in historico */
  lineas: string[];
  resumen: PerformanceResumen;
  prestamosOtorgados: PerformancePrestamosOtorgados[];
  moraAntigüedad: PerformanceMoraBucket[];
}

// Numbers are internally consistent:
// - AMEJUCA leads in total monto → appears first in montosPorLinea and resumen.lineaTop
// - Galaz leads in monto ranking → resumen.vendedorTopMonto
// - Pérez leads in quantity ranking → resumen.vendedorTopCantidad
// - Historical series for AMEJUCA shows consistently higher values than the others

export const PERFORMANCE_MOCK: PerformanceData = {
  kpis: {
    montoSolicitado: 128_400_000,
    montoEnGestion: 42_700_000,
    montoEnviadoTesoreria: 24_800_000,
    moraTotal: 3_500_000,
    dineroDisponible: 15_200_000,
    variacionSolicitado: 12.4,
    variacionGestion: -3.1,
    variacionTesoreria: 8.7,
    variacionMora: 5.2,
  },

  montosPorLinea: [
    { linea: "AMEJUCA ESPECIAL", monto: 71_860_000 },
    { linea: "NUEVOS CBU", monto: 43_600_000 },
    { linea: "PROPIA RECURRENTE CBU", monto: 12_940_000 },
  ],

  rankingMonto: [
    { nombre: "Vega, Rodrigo", monto: 14_860_000 },
    { nombre: "Pérez, Mariana", monto: 12_300_000 },
    { nombre: "Romero, Juan", monto: 9_800_000 },
    { nombre: "López, Martín", monto: 8_400_000 },
    { nombre: "Sosa, Natalia", monto: 6_200_000 },
    { nombre: "Torres, Diego", monto: 4_100_000 },
  ],

  rankingCantidad: [
    { nombre: "Pérez, Mariana", cantidad: 28 },
    { nombre: "Vega, Rodrigo", cantidad: 24 },
    { nombre: "Torres, Diego", cantidad: 18 },
    { nombre: "López, Martín", cantidad: 15 },
    { nombre: "Romero, Juan", cantidad: 12 },
    { nombre: "Sosa, Natalia", cantidad: 8 },
  ],

  lineas: ["AMEJUCA ESPECIAL", "NUEVOS CBU", "PROPIA RECURRENTE CBU"],

  historico: {
    "AMEJUCA ESPECIAL": [
      { periodo: "Nov '25", monto: 8_200_000 },
      { periodo: "Dic '25", monto: 7_400_000 },
      { periodo: "Ene '26", monto: 9_200_000 },
      { periodo: "Feb '26", monto: 11_400_000 },
      { periodo: "Mar '26", monto: 10_800_000 },
      { periodo: "Abr '26", monto: 14_200_000 },
      { periodo: "May '26", monto: 13_600_000 },
      { periodo: "Jun '26", monto: 12_660_000 },
    ],
    "NUEVOS CBU": [
      { periodo: "Nov '25", monto: 4_800_000 },
      { periodo: "Dic '25", monto: 3_900_000 },
      { periodo: "Ene '26", monto: 6_100_000 },
      { periodo: "Feb '26", monto: 7_200_000 },
      { periodo: "Mar '26", monto: 8_400_000 },
      { periodo: "Abr '26", monto: 7_800_000 },
      { periodo: "May '26", monto: 7_100_000 },
      { periodo: "Jun '26", monto: 7_000_000 },
    ],
    "PROPIA RECURRENTE CBU": [
      { periodo: "Nov '25", monto: 1_200_000 },
      { periodo: "Dic '25", monto: 900_000 },
      { periodo: "Ene '26", monto: 1_800_000 },
      { periodo: "Feb '26", monto: 2_100_000 },
      { periodo: "Mar '26", monto: 2_400_000 },
      { periodo: "Abr '26", monto: 2_200_000 },
      { periodo: "May '26", monto: 2_440_000 },
      { periodo: "Jun '26", monto: 2_000_000 },
    ],
  },

  resumen: {
    lineaTop: "AMEJUCA ESPECIAL",
    montoTopLinea: 71_860_000,
    vendedorTopMonto: "Vega, Rodrigo",
    montoTopVendedor: 14_860_000,
    vendedorTopCantidad: "Pérez, Mariana",
    cantidadTopVendedor: 28,
  },

  prestamosOtorgados: [
    { periodo: "Nov '25", cantidad: 42, monto: 14_200_000 },
    { periodo: "Dic '25", cantidad: 31, monto: 12_300_000 },
    { periodo: "Ene '26", cantidad: 55, monto: 17_100_000 },
    { periodo: "Feb '26", cantidad: 61, monto: 20_700_000 },
    { periodo: "Mar '26", cantidad: 65, monto: 23_600_000 },
    { periodo: "Abr '26", cantidad: 72, monto: 24_200_000 },
    { periodo: "May '26", cantidad: 68, monto: 23_100_000 },
    { periodo: "Jun '26", cantidad: 54, monto: 19_660_000 },
  ],

  moraAntigüedad: [
    { bucket: "1-30 días", monto: 3_240_000, cantidad: 18 },
    { bucket: "31-60 días", monto: 1_860_000, cantidad: 9 },
    { bucket: "61-90 días", monto: 940_000, cantidad: 4 },
    { bucket: "+90 días", monto: 620_000, cantidad: 3 },
  ],
};
