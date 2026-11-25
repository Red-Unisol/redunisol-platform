import { SolicitudesError } from "../../../solicitudes/domain/solicitudes-errors";

export const AMEJUCA_VARIANTS = ["CELESOL", "RED_UNISOL"] as const;
export type AmejucaVariant = (typeof AMEJUCA_VARIANTS)[number];

// OID de LineaPrestamoPresolicitud. El código de firma de Vimarx puede
// coincidir entre variantes, así que no identifica qué línea puede ofrecerse.
const amejucaLineVariants: ReadonlyMap<string, AmejucaVariant> = new Map([
  ["2519", "CELESOL"],
  ["2657", "CELESOL"],
  ["2664", "CELESOL"],
  ["2770", "CELESOL"],
  ["2771", "CELESOL"],
  ["2772", "RED_UNISOL"],
  ["2773", "RED_UNISOL"],
  ["2774", "RED_UNISOL"],
  ["2775", "RED_UNISOL"],
  ["2776", "RED_UNISOL"],
  ["2787", "RED_UNISOL"],
]);

export function amejucaLineVariant(oid: string | null) {
  return oid === null ? undefined : amejucaLineVariants.get(oid);
}

export function isAmejucaLineAvailable(
  oid: string | null,
  activeVariant: AmejucaVariant,
) {
  const variant = amejucaLineVariant(oid);
  return variant === undefined || variant === activeVariant;
}

export class AmejucaLineUnavailableError extends SolicitudesError {
  constructor() {
    super(
      "Esta línea de AMEJUCA está inhabilitada para altas y cambios de línea. Elegí una línea disponible.",
      409,
    );
    this.name = "AmejucaLineUnavailableError";
  }
}
