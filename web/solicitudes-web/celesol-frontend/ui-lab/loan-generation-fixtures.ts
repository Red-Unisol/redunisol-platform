import type {
  LoanGenerationCheck,
  LinkedLoanStatus,
} from "../src/modules/solicitudes-core/services/linked-loan-status-api";

export const generationRecovery = {
  requestId: "91de68cb-39b8-40c4-b5d7-fc87322c7b34",
  status: "CREATING",
  knownLoanId: null,
  expectedUpdatedAt: "2026-11-17T12:00:00.000Z",
};
export function generationStatus(): LinkedLoanStatus {
  return {
    status: "unavailable",
    currentLoanId: null,
    amount: null,
    requestedAmount: 250000,
    matchesAmount: false,
    amountEditable: false,
    reason: "Hay una generación de préstamo pendiente de verificar.",
    recovery: generationRecovery,
  };
}
export function createGenerationFixture(scenario: string, id: string) {
  return async (
    method: string,
    path: string,
    body: BodyInit | null | undefined,
  ) => {
    const base = `/solicitudes/${id}/loan-generation`;
    if (
      method !== "POST" ||
      ![`${base}/check`, `${base}/release`, `${base}/recover-checked`].includes(
        path,
      )
    )
      return null;
    const respond = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (path === `${base}/check`) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (scenario === "error")
        return respond(
          {
            error: {
              message: "Vimarx no respondió. La reserva sigue protegida.",
            },
          },
          503,
        );
      const match = scenario === "match" || scenario === "stale";
      const result: LoanGenerationCheck = {
        ...generationRecovery,
        checkedAt: "2026-11-17T12:05:00.000Z",
        status: match
          ? "match"
          : scenario === "ambiguous"
            ? "ambiguous"
            : "empty",
        canRecover: match,
        canRelease: scenario === "safe",
        reason: match
          ? "Encontramos un préstamo compatible en Vimarx. Un administrador puede comprobar sus datos y recuperar la vinculación."
          : scenario === "safe"
            ? "Vimarx no registra un préstamo del intento y comprobamos que la generación no se envió. Un administrador puede liberar la reserva."
            : scenario === "ambiguous"
              ? "Encontramos varios préstamos del socio desde el intento. Un administrador debe identificar el correcto; la reserva sigue protegida."
              : "Vimarx no registra un préstamo del intento, pero no pudimos descartar que la generación termine más tarde. La reserva sigue protegida; requiere revisión administrativa.",
        candidate: match
          ? {
              id: "99001",
              account: "900001",
              createdAt: "2026-11-17T09:01:00",
              amount: 250000,
              cuotas: 12,
              primerVencimiento: "2026-12-31",
            }
          : null,
      };
      return respond(result);
    }
    const input = JSON.parse(String(body)) as { reason?: string };
    if (scenario === "stale")
      return respond(
        {
          error: {
            message:
              "La reserva cambió. Actualizá la solicitud y volvé a comprobar.",
          },
        },
        409,
      );
    if ((input.reason?.trim().length ?? 0) < 10)
      return respond(
        { error: { message: "Indicá el motivo obligatorio." } },
        400,
      );
    if (path.endsWith("/release") && scenario === "safe")
      return respond({ released: true });
    if (path.endsWith("/recover-checked") && scenario === "match")
      return respond({ linked: true });
    return respond({ error: { message: "La reserva sigue protegida." } }, 409);
  };
}
