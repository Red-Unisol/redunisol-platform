import type { BadgeVariant } from "@/shared/components/ui/badge";

// Mapeo semántico estado -> color de Badge. Espejo de la intención de colores
// de ESTADO_STYLES (admin-dashboard-shared.tsx) pero acotado a los 4 variants
// que soporta Badge (success/warning/danger/neutral), en vez de una paleta
// por estado. Estados no listados caen a "neutral".
const ESTADO_BADGE_VARIANTS: Record<string, BadgeVariant> = {
  CargaVendedor: "warning",
  Confirmada: "success",
  Desestimada: "danger",
  Liquidada: "success",
  Motor: "neutral",
  PreAprobada: "success",
  Rechazada: "danger",
  Revisar: "warning",
  RevisionRiesgo: "warning",
  Transferir: "success",
  Vencida: "danger",
};

export function getEstadoBadgeVariant(estadoCode: string): BadgeVariant {
  return ESTADO_BADGE_VARIANTS[estadoCode] ?? "neutral";
}
