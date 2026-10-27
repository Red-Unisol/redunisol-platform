// Copia de web/herramientas/resources/js/credix-bcra.js, para que la pestaña
// CredixSA muestre el BCRA igual que herramientas. Si cambia alla, hay que
// traer el cambio aca tambien.

export type CredixsaDeudaVigente = {
  entidad?: string;
  monto?: string;
  periodo?: string;
  raw?: unknown[];
  situacion?: string;
};

export type CredixsaBcra = {
  consulta_directa_estado?: string;
  consultado_en?: string;
  deuda_situacion_negativa_total?: string | null;
  deuda_vigente_total?: string;
  deudas_24_meses?: {
    anios?: Array<{ anio?: string; span?: number }>;
    filas?: Array<{
      activa?: boolean;
      entidad?: string;
      observacion?: string;
      situaciones?: string[];
      ultimo_monto_informado?: string;
    }>;
    meses?: string[];
  };
  deudas_vigentes?: CredixsaDeudaVigente[];
  evolucion_deuda_por_entidad?: {
    entidades?: string[];
    filas?: Array<{
      celdas?: Array<{ monto?: string; situacion?: string }>;
      periodo?: string;
    }>;
  };
  fuente?: string;
  historial_por_entidad?: Array<{
    entidades?: Record<string, string>;
    periodo?: string;
  }>;
  mensaje?: string;
};

// Both sources share the same display contract. Existing CredixSA cache entries
// may omit the situation on subsequent rows of a merged HTML cell.
export function prepareCredixBcra(
  bcra: CredixsaBcra | null | undefined,
): CredixsaBcra {
  bcra = bcra || {};
  if (bcra.fuente === "BCRA") {
    const unknown = array(bcra.deudas_vigentes).some(
      (row) => !bcraSituation(row?.situacion),
    );
    return unknown ? { ...bcra, deuda_situacion_negativa_total: null } : bcra;
  }
  let groupSituation = "";
  const debts = array(bcra.deudas_vigentes).map((row) => {
    const raw = Array.isArray(row.raw) ? row.raw : [];
    if (/^[1-6]$/.test(String(raw[0] ?? ""))) groupSituation = String(raw[0]);
    const inherited =
      raw.length && !/^\d/.test(String(raw[0])) ? groupSituation : "";
    return { ...row, situacion: row.situacion || inherited };
  });
  let negative = 0;
  let complete =
    debts.length > 0 || amountInCents(bcra.deuda_vigente_total) === 0;
  for (const row of debts) {
    const cents = amountInCents(row.monto);
    if (!/^[1-6]$/.test(String(row.situacion)) || cents === null) {
      complete = false;
    } else if (Number(row.situacion) >= 2) {
      negative += cents;
    }
  }
  return {
    ...bcra,
    fuente: "CredixSA",
    deudas_vigentes: debts,
    deuda_situacion_negativa_total:
      complete && Number.isSafeInteger(negative) ? formatCents(negative) : null,
  };
}

// Keep the original value in the report; only 1..6 are credit classifications.
export function bcraSituation(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return /^[1-6]$/.test(text) ? text : null;
}

export function formatBcraSituation(value: unknown): string {
  return bcraSituation(value) ?? "N/D";
}

function amountInCents(value: unknown): number | null {
  const text = String(value ?? "")
    .replace(/^\$\s*/, "")
    .trim();
  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(text)) return null;
  const amount = Math.round(
    Number(text.replaceAll(".", "").replace(",", ".")) * 100,
  );
  return Number.isSafeInteger(amount) ? amount : null;
}

function formatCents(value: number): string {
  return (
    "$ " +
    (value / 100).toLocaleString("es-AR", {
      minimumFractionDigits: value % 100 ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}

function array<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}
