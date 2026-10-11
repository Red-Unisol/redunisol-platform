// Vigente no representa deuda ni cancelación. Estado=0 es activo en Vimarx.
export function clasificarEstadoPrestamo(prestamo: { estado?: number | null }) {
  if (typeof prestamo.estado !== "number" || !Number.isInteger(prestamo.estado))
    return "desconocidos";
  return prestamo.estado === 0 ? "activos" : "otros";
}
