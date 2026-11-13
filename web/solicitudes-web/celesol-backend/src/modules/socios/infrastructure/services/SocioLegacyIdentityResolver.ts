export type SocioLegacyIdentity = {
  nroDocumento?: string | null;
  tipoDocumento?: string | null;
  cuit?: string | null;
};

export type SocioLegacyResolution =
  | { status: "single"; id: string }
  | { status: "none" }
  | { status: "ambiguous"; ids: string[] };

export class SocioLegacyIdentityUnavailableError extends Error {}

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{ json(): Promise<unknown>; ok: boolean }>;

const MAX_CANDIDATES = 21;

/** Resolución en vivo, compartida por préstamos, resumen, CBU y evaluación. */
export class SocioLegacyIdentityResolver {
  constructor(
    private readonly config: { baseUrl: string; timeoutMs: number },
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async resolve(input: SocioLegacyIdentity): Promise<SocioLegacyResolution> {
    const documento = identifier(input.nroDocumento, 1, 12);
    const cuit = identifier(input.cuit, 11, 11);
    const tipo = input.tipoDocumento?.trim().toUpperCase() || null;
    if (!documento && !cuit) throw new SocioLegacyIdentityUnavailableError();

    const criteria: string[] = [];
    if (documento) {
      criteria.push(
        `([NroDoc] = ${documento}${tipo ? ` And [TipoDoc.Descripcion] = '${tipo.replaceAll("'", "''")}'` : ""})`,
      );
    }
    if (cuit) {
      criteria.push(`[CUIT] = '${cuit}'`);
      // En personas jurídicas, Vimarx puede guardar el CUIT sólo en NroDoc.
      if (!documento) criteria.push(`[NroDoc] = ${cuit}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(
        new URL("/api/Empresa/EvaluateList", this.config.baseUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo: "F.Module.SocioMutual",
            cmd: criteria.join(" Or "),
            campos: "ID;NroDoc;CUIT;TipoDoc.Descripcion",
            max: MAX_CANDIDATES,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new SocioLegacyIdentityUnavailableError();
      const body = await response.json();
      if (!Array.isArray(body) || body.length >= MAX_CANDIDATES) {
        throw new SocioLegacyIdentityUnavailableError();
      }
      const candidates = body.map((row: unknown) => {
        if (
          !Array.isArray(row) ||
          row.length !== 4 ||
          !/^[1-9]\d*$/.test(String(row[0] ?? "")) ||
          (row[3] !== null && typeof row[3] !== "string")
        ) {
          throw new SocioLegacyIdentityUnavailableError();
        }
        return {
          id: String(row[0]),
          documento: identifier(row[1], 1, 12),
          cuit: identifier(row[2], 11, 11),
          tipo: row[3]?.trim().toUpperCase() || null,
        };
      });
      if (new Set(candidates.map((row) => row.id)).size !== candidates.length) {
        throw new SocioLegacyIdentityUnavailableError();
      }
      if (!candidates.length) return { status: "none" };

      const byDocument = (row: (typeof candidates)[number]) =>
        row.documento === (documento ?? cuit) && (!tipo || row.tipo === tipo);
      // Un CUIT exacto desempata documentos duplicados, pero nunca permite
      // ignorar un documento distinto explícitamente cargado en ese registro.
      const exact = cuit
        ? candidates.filter(
            (row) =>
              row.cuit === cuit &&
              (!documento || !row.documento || row.documento === documento),
          )
        : [];
      if (exact.length) return resolution(exact);

      const compatible = candidates.filter(
        (row) => byDocument(row) && (!cuit || !row.cuit),
      );
      // Sólo se admite el respaldo por documento si no hay CUIT contradictorio.
      // Un conflicto no significa "no socio" y no habilita un alta nueva.
      if (compatible.length !== candidates.length)
        throw new SocioLegacyIdentityUnavailableError();
      return resolution(compatible);
    } catch {
      throw new SocioLegacyIdentityUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }
}

function resolution(rows: { id: string }[]): SocioLegacyResolution {
  if (rows.length === 1) return { status: "single", id: rows[0]!.id };
  return { status: "ambiguous", ids: rows.map((row) => row.id) };
}

function identifier(value: unknown, min: number, max: number): string | null {
  if (value === null || value === undefined || value === "" || value === 0)
    return null;
  if (typeof value !== "string" && typeof value !== "number")
    throw new SocioLegacyIdentityUnavailableError();
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new SocioLegacyIdentityUnavailableError();
  const normalized = String(value).replace(/[.\s-]/g, "");
  if (!normalized) return null;
  if (
    !/^\d+$/.test(normalized) ||
    normalized.length < min ||
    normalized.length > max ||
    /^0+$/.test(normalized)
  ) {
    throw new SocioLegacyIdentityUnavailableError();
  }
  return normalized.replace(/^0+(?=\d)/, "");
}
