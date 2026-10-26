export type ScenarioId =
  | "new"
  | "compatible"
  | "amount-mismatch"
  | "conditions-mismatch"
  | "cancelled"
  | "unverifiable"
  | "processing"
  | "uncertain"
  | "success";
export type ScenarioTone = "neutral" | "success" | "warning" | "danger";
export type LoanCondition = {
  amount: number;
  cuotas: number;
  line: string;
  firstDue: string;
  cancellations: number;
};
export type CoreLoan = LoanCondition & {
  id: string;
  status: "active" | "cancelled" | "unknown";
  capital: number;
  balance: number | null;
  current: boolean | null;
};
export type Scenario = {
  id: ScenarioId;
  title: string;
  shortTitle: string;
  description: string;
  tone: ScenarioTone;
  tag: string;
  core: CoreLoan | null;
  operationMode?: "new" | "reuse" | "replacement";
};
export type ConditionDifference = { label: string; beex: string; core: string };

export const SAMPLE_REQUEST = {
  id: "00000000-0000-4000-8000-000000000001",
  number: "BEEX-0241",
  name: "MARÍA EJEMPLO",
  member: "DEMO-0241",
  amount: 600000,
  cuotas: 12,
  line: "AMEJUCA RECURRENTE ESPECIAL",
  firstDue: "30/11/2026",
  cancellations: 0,
  installment: 101658.01,
  expenses: 60000,
  capital: 660000,
  total: 1219896.14,
} as const;

const ACTIVE: CoreLoan = {
  id: "999001",
  amount: SAMPLE_REQUEST.amount,
  cuotas: SAMPLE_REQUEST.cuotas,
  line: SAMPLE_REQUEST.line,
  firstDue: SAMPLE_REQUEST.firstDue,
  cancellations: 0,
  capital: 660000,
  status: "active",
  balance: -1219896.14,
  current: true,
};

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "new",
    title: "Sin préstamo vinculado",
    shortTitle: "Sin préstamo",
    description:
      "Generar un préstamo y pasar a Liquidada desde una sola confirmación.",
    tone: "neutral",
    tag: "Alta nueva",
    core: null,
  },
  {
    id: "compatible",
    title: "Préstamo activo compatible",
    shortTitle: "Activo compatible",
    description:
      "Monto, cuotas, línea, vencimiento y cancelaciones coinciden. Se utiliza el préstamo existente.",
    tone: "success",
    tag: "Reutilizar",
    core: ACTIVE,
  },
  {
    id: "amount-mismatch",
    title: "Préstamo activo con otro monto",
    shortTitle: "Monto diferente",
    description:
      "Beex solicita $600.000 y el préstamo activo de Vimarx tiene $1.500.000. La liquidación queda bloqueada.",
    tone: "danger",
    tag: "Bloqueado",
    core: { ...ACTIVE, amount: 1500000, capital: 1650000 },
  },
  {
    id: "conditions-mismatch",
    title: "Mismo monto, otras condiciones",
    shortTitle: "Otras diferencias",
    description:
      "El monto solicitado coincide, pero cuotas, línea, vencimiento o cancelaciones no coinciden.",
    tone: "danger",
    tag: "Bloqueado",
    core: {
      ...ACTIVE,
      cuotas: 18,
      line: "CAJA PREMIUM",
      firstDue: "31/12/2026",
      cancellations: 100000,
    },
  },
  {
    id: "cancelled",
    title: "Préstamo anterior anulado",
    shortTitle: "Anulado confirmado",
    description:
      "La anulación está confirmada, sin vigencia y con saldo cero. Se puede generar el reemplazo y liquidar.",
    tone: "success",
    tag: "Regenerar",
    core: {
      ...ACTIVE,
      status: "cancelled",
      amount: 0,
      cuotas: 0,
      capital: 0,
      balance: 0,
      current: false,
    },
  },
  {
    id: "unverifiable",
    title: "Vimarx no se puede verificar",
    shortTitle: "Sin respuesta de Core",
    description:
      "Se conoce el vínculo, pero no se puede comprobar el estado ni las condiciones actuales del préstamo.",
    tone: "warning",
    tag: "Reconsultar",
    core: { ...ACTIVE, status: "unknown", balance: null, current: null },
  },
  {
    id: "processing",
    title: "Operación en curso",
    shortTitle: "Procesando",
    description:
      "Una sola operación en ejecución. No permite una segunda generación ni cambiar datos durante el proceso.",
    tone: "neutral",
    tag: "En proceso",
    core: null,
  },
  {
    id: "uncertain",
    title: "Resultado de generación incierto",
    shortTitle: "Resultado incierto",
    description:
      "La respuesta no confirmó el resultado. Se verifica el mismo intento antes de continuar, sin generar otro a ciegas.",
    tone: "warning",
    tag: "Verificar resultado",
    core: null,
  },
  {
    id: "success",
    title: "Préstamo vinculado y solicitud liquidada",
    shortTitle: "Liquidada",
    description:
      "Préstamo confirmado, estado Liquidada y trazabilidad guardada. Continúa el circuito habitual de firma.",
    tone: "success",
    tag: "Completado",
    core: { ...ACTIVE, id: "999002" },
  },
];

export function getScenario(id: string | null): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}

export function money(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(value);
}

export function conditionDifferences(
  scenario: Scenario,
): ConditionDifference[] {
  const loan = scenario.core;
  // La anulación confirmada domina la decisión. Los importes que el Core dejó
  // en cero después de anular no se interpretan como diferencias de un activo.
  if (!loan || loan.status !== "active") return [];
  const candidates = [
    {
      label: "Monto solicitado",
      beex: money(SAMPLE_REQUEST.amount),
      core: money(loan.amount),
    },
    {
      label: "Cantidad de cuotas",
      beex: String(SAMPLE_REQUEST.cuotas),
      core: String(loan.cuotas),
    },
    { label: "Línea", beex: SAMPLE_REQUEST.line, core: loan.line },
    {
      label: "Primer vencimiento",
      beex: SAMPLE_REQUEST.firstDue,
      core: loan.firstDue,
    },
    {
      label: "Cancelaciones",
      beex: money(SAMPLE_REQUEST.cancellations),
      core: money(loan.cancellations),
    },
  ];
  return candidates.filter((row) => row.beex !== row.core);
}

export function actionLabel(scenario: Scenario): string {
  if (scenario.id === "cancelled") return "Regenerar préstamo y liquidar";
  if (scenario.id === "processing")
    return scenario.operationMode === "reuse"
      ? "Liquidando..."
      : "Generando y liquidando...";
  if (scenario.id === "uncertain") return "Verificar resultado";
  if (scenario.id === "success") return "Solicitud liquidada";
  if (scenario.id === "unverifiable") return "Liquidar solicitud";
  if (scenario.core) return "Liquidar con préstamo existente";
  return "Generar préstamo y liquidar";
}

export function canConfirm(scenario: Scenario): boolean {
  return ["new", "compatible", "cancelled"].includes(scenario.id);
}

export const INSTALLMENTS = [
  "30/11/2026",
  "31/12/2026",
  "31/01/2027",
  "28/02/2027",
  "31/03/2027",
  "30/04/2027",
  "31/05/2027",
  "30/06/2027",
  "31/07/2027",
  "31/08/2027",
  "30/09/2027",
  "31/10/2027",
].map((date, index) => ({
  number: index + 1,
  date,
  amount: index < 11 ? 101658.01 : 101658.03,
}));
