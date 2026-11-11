import type { PadronesResponse } from "../src/modules/solicitudes-core/services/padrones-api";

export const PADRONES_SCENARIOS = [
  "mixed",
  "none",
  "error",
  "unconfigured",
  "missing-document",
  "credixsa-error",
  "bajas",
] as const;
export type PadronesScenario = (typeof PADRONES_SCENARIOS)[number];
export function parsePadronesScenario(value: string | null): PadronesScenario {
  return PADRONES_SCENARIOS.includes(value as PadronesScenario)
    ? (value as PadronesScenario)
    : "mixed";
}
export function padronesFixture(
  scenario: PadronesScenario = "mixed",
): PadronesResponse {
  if (scenario === "error") return { status: "unavailable" };
  if (scenario === "unconfigured") return { status: "not_configured" };
  if (scenario === "missing-document") return { status: "missing_document" };
  const matches =
    scenario === "none"
      ? []
      : [
          {
            row: 2,
            data: {
              CUIL: "20-12345678-3",
              Nombre: "Persona de ejemplo",
              Cargo: "Docente de ejemplo",
            },
          },
          {
            row: 3,
            data: {
              CUIL: "20-12345678-3",
              Nombre: "Persona de ejemplo",
              Cargo: "Segundo cargo de ejemplo",
            },
          },
        ];
  return {
    status: "available",
    document: "12345678",
    queried_at: "2026-11-11T17:00:00Z",
    sources: [
      {
        id: "administracion",
        name: "Administración",
        kind: "padron",
        status: "needs_review",
        period: "2026-11",
        loaded_at: "2026-11-11T12:00:00Z",
        matches: [],
      },
      {
        id: "educacion",
        name: "Educación",
        kind: "padron",
        status: "ready",
        period: "2026-11",
        loaded_at: "2026-11-11T12:00:00Z",
        matches,
      },
      {
        id: "senado",
        name: "Senado",
        kind: "padron",
        status: "ready",
        period: "2026-08",
        loaded_at: "2026-09-30T12:00:00Z",
        matches: [],
      },
      {
        id: "bajas",
        name: "Bajas de agentes",
        kind: "bajas",
        status: scenario === "bajas" ? "ready" : "unpublished",
        period: scenario === "bajas" ? "2026-11" : null,
        loaded_at: scenario === "bajas" ? "2026-11-11T12:00:00Z" : null,
        matches:
          scenario === "bajas"
            ? [
                {
                  row: 2,
                  data: { Fecha: "01/11/2026", Causa: "Baja de ejemplo" },
                },
              ]
            : [],
      },
    ],
  };
}
