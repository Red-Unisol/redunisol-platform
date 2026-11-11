import type { CbuHabitualResponse } from "../src/modules/solicitudes-core/services/datos-rapidos-api";

// Identidades y cuentas ficticias. Nunca consultar una API real desde el laboratorio.
export const HABITUAL_CBU = "0110000699111100000248";
export const OTHER_CBU = "0200322911000015391276";
const scenarios = [
  "match",
  "different",
  "missing",
  "not_member",
  "ambiguous",
  "unavailable",
  "invalid",
  "empty",
  "nonhabitual",
  "refresh-error",
] as const;
export type CbuScenario = (typeof scenarios)[number];
export function parseCbuScenario(
  value: string | null,
): CbuScenario | undefined {
  return scenarios.find((scenario) => scenario === value);
}
export function solicitudCbuFixture(scenario: CbuScenario) {
  return {
    cbu:
      scenario === "empty"
        ? null
        : scenario === "different"
          ? OTHER_CBU
          : HABITUAL_CBU,
    cbuNoHabitual: scenario === "nonhabitual" ? OTHER_CBU : null,
  };
}
export function habitualCbuFixture(
  scenario: CbuScenario = "match",
  attempt = 1,
): CbuHabitualResponse {
  if (
    scenario === "missing" ||
    scenario === "not_member" ||
    scenario === "ambiguous" ||
    scenario === "unavailable"
  )
    return { status: scenario, cbu: null };
  if (scenario === "refresh-error" && attempt === 2)
    return { status: "unavailable", cbu: null };
  return {
    status: "available",
    cbu: scenario === "invalid" ? "123" : HABITUAL_CBU,
  };
}
