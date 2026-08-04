import type { SocioMutualPullRow } from "../../infrastructure/services/EvaluateListSociosMutualGateway";

export type MappedSocioRow = {
  apellido: string | null;
  celular: string | null;
  cuit: string;
  email: string | null;
  fechaDeNacimiento: string | null;
  nombre: string | null;
  nroDocumento: string | null;
  nroSocioLegacy: string | null;
  razonSocial: string | null;
  sexo: string | null;
  tipoDocumento: string | null;
  tipoPersona: "FISICA" | "JURIDICA";
};

export type ClassifySkipReason = "incomplete_fisica" | "missing_cuit";

export type ClassifyResult =
  | { ok: true; row: MappedSocioRow }
  | { ok: false; reason: ClassifySkipReason };

const JURIDICA_TIPO_DOC_DESCRIPCION = "CUIT";

function blankToNull(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed ? trimmed : null;
}

/**
 * Maps a raw SocioMutual row (Vimax) to `socios` table columns.
 *
 * `TipoDoc.Descripcion === "CUIT"` is the discriminador for juridica vs
 * fisica -- confirmed against two known real records in Vimax (ID 152198
 * fisica / 152199 juridica). `Sexo` does NOT work for this: EvaluateList
 * returns an internal numeric code for it (not the "PersonaJuridica" string
 * used when creating a socio), and the same code can show up for both fisica
 * and juridica rows.
 *
 * For juridica, Vimax echoes the CUIT back in `NroDoc` too -- nro_documento
 * is forced to null regardless, since the `socios` table has a check
 * constraint requiring it (and the rest of the fisica-only fields) to be
 * null for JURIDICA.
 *
 * The same check constraint requires fisica rows to have apellido, nombre,
 * nro_documento, tipo_documento, sexo and fecha_de_nacimiento all non-null --
 * old legacy records sometimes miss one of these, so those rows are skipped
 * (reason "incomplete_fisica") rather than inserted broken.
 *
 * `sexo` is stored as the raw numeric code Vimax returns (no confirmed
 * mapping to "Masculino"/"Femenino" labels exists via this API).
 */
export function classifySocioMutualRow(row: SocioMutualPullRow): ClassifyResult {
  const cuit = blankToNull(row.cuit);

  if (cuit === null) {
    return { ok: false, reason: "missing_cuit" };
  }

  const nroSocioLegacy = row.id === null ? null : String(row.id);
  const email = blankToNull(row.email);
  const celular = blankToNull(row.celular);
  const isJuridica =
    blankToNull(row.tipoDocDescripcion) === JURIDICA_TIPO_DOC_DESCRIPCION;

  if (isJuridica) {
    const apellidoRaw = blankToNull(row.apellido);
    const nombreCompleto = blankToNull(row.nombreCompleto);

    return {
      ok: true,
      row: {
        apellido: null,
        celular,
        cuit,
        email,
        fechaDeNacimiento: null,
        nombre: null,
        nroDocumento: null,
        nroSocioLegacy,
        razonSocial: apellidoRaw ?? nombreCompleto,
        sexo: null,
        tipoDocumento: null,
        tipoPersona: "JURIDICA",
      },
    };
  }

  const apellido = blankToNull(row.apellido);
  const nombre = blankToNull(row.nombre);
  const nroDocumento = blankToNull(row.nroDoc);
  const tipoDocumento = blankToNull(row.tipoDocDescripcion);
  const sexo = blankToNull(row.sexo);
  const fechaDeNacimiento = blankToNull(row.fechaDeNacimiento);

  if (
    apellido === null ||
    nombre === null ||
    nroDocumento === null ||
    tipoDocumento === null ||
    sexo === null ||
    fechaDeNacimiento === null
  ) {
    return { ok: false, reason: "incomplete_fisica" };
  }

  return {
    ok: true,
    row: {
      apellido,
      celular,
      cuit,
      email,
      fechaDeNacimiento,
      nombre,
      nroDocumento,
      nroSocioLegacy,
      razonSocial: null,
      sexo,
      tipoDocumento,
      tipoPersona: "FISICA",
    },
  };
}
