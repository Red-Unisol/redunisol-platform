import { apiClient, fetchConSesion } from "@/shared/services/http/api-client";
import { ApiError } from "@/shared/services/http/api-error";

export type ExternalPaymentView = {
  canRegister: boolean;
  blockedReason: string | null;
  reservationPending: boolean;
  payment: {
    id: string;
    paidOn: string;
    reference: string;
    comment: string | null;
    adjuntoId: string;
    recordedAt: string;
    recordedBy: string;
  } | null;
};

export const getExternalPayment = (id: string) =>
  apiClient.get<ExternalPaymentView>(`/solicitudes/${id}/pago-externo`);

export async function registerExternalPayment(
  id: string,
  input: {
    requestId: string;
    paidOn: string;
    reference: string;
    comment: string;
    file: File;
  },
) {
  const form = new FormData();
  form.set("requestId", input.requestId);
  form.set("paidOn", input.paidOn);
  form.set("reference", input.reference.trim());
  form.set("comment", input.comment.trim());
  form.set("file", input.file);
  const response = await fetchConSesion(`/solicitudes/${id}/pago-externo`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(
      body.error?.message ?? "No se pudo registrar el pago externo.",
      response.status,
      undefined,
      JSON.stringify(body),
      body.error?.code,
    );
  return body as ExternalPaymentView;
}
