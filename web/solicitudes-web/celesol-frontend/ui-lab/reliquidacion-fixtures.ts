import type { ReliquidationView } from "@/modules/solicitudes-core/components/loan-reliquidation-control";

const scenarios = [
  "ready",
  "prepared",
  "pending",
  "blocked",
  "error",
  "refresh-error",
] as const;
export type ReliquidationScenario = (typeof scenarios)[number];
export function parseReliquidationScenario(
  value: string | null,
): ReliquidationScenario {
  return scenarios.includes(value as ReliquidationScenario)
    ? (value as ReliquidationScenario)
    : "ready";
}

/** Opt-in transport for the real control. All writes affect this closure only. */
export function createReliquidationFixture(
  scenario: ReliquidationScenario,
  id: string,
) {
  const base = `/solicitudes/${id}/reliquidacion`;
  let attempted = false;
  let data: ReliquidationView = {
    visible: true,
    pending: scenario === "pending",
    prepared: scenario === "prepared",
    canReopen: scenario !== "blocked",
    previousLoanId: "900001",
    updatedAt: "2026-11-11T12:00:00.000Z",
    blockedReason:
      scenario === "blocked"
        ? "Existe una reserva de transferencia. Esta versión no cancela reservas."
        : null,
    ...(scenario === "prepared"
      ? {
          requestId: "47a40294-15f9-443d-a499-9b3380381ec3",
          reason: "Corrección solicitada por el analista",
        }
      : {}),
  };
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  return async (
    method: string,
    path: string,
    body: BodyInit | null | undefined,
  ) => {
    if (method === "GET" && path === base) {
      if (attempted && (scenario === "error" || scenario === "refresh-error")) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return response(
          { error: { message: "No se pudo actualizar la consulta." } },
          503,
        );
      }
      return response(data);
    }
    if (method === "POST" && [base, `${base}/preparar`].includes(path)) {
      attempted = true;
      if (scenario === "error")
        return response(
          {
            error: {
              message:
                "No se pudo pausar la solicitud: existe una reserva de transferencia.",
            },
          },
          409,
        );
      const input = JSON.parse(String(body));
      data = {
        ...data,
        prepared: path.endsWith("/preparar"),
        pending: path === base,
        updatedAt: new Date().toISOString(),
        requestId: input.requestId,
        reason: input.reason,
      };
      return response(data);
    }
    return undefined;
  };
}
