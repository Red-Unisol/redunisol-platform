import { esCbuValido } from "../../../shared/utils/cbu.ts";

export const normalizeCbu = (value: string | null | undefined) =>
  (value ?? "").replace(/[\s-]/g, "");

export function compareCbu(
  solicitud: string | null | undefined,
  habitual: string,
) {
  const value = normalizeCbu(solicitud);
  if (!value) return "empty";
  if (!esCbuValido(value)) return "invalid";
  const source = normalizeCbu(habitual);
  if (!esCbuValido(source)) return "unverified";
  return value === source ? "match" : "different";
}

type Identity = { nroDocumento: string | null; tipoDocumento: string | null };
export function cbuIdentityChanged(saved: Identity, draft: Identity) {
  const documento = (value: string | null) =>
    (value ?? "").replace(/[.\s-]/g, "");
  const tipo = (value: string | null) => (value ?? "").trim().toUpperCase();
  return (
    documento(saved.nroDocumento) !== documento(draft.nroDocumento) ||
    tipo(saved.tipoDocumento) !== tipo(draft.tipoDocumento)
  );
}
