import { fail, type FinancialGateway, type LoanFinancials } from "./domain";

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;
export class LegacyFinancialGateway implements FinancialGateway {
  constructor(
    private readonly config: { baseUrl: string; timeoutMs: number },
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private async row(
    tipo: string,
    id: string,
    fields: string[],
    memberLegacyId?: string,
  ): Promise<unknown[]> {
    if (!/^\d+$/.test(id))
      fail("INVALID_LEGACY_ID", "Identificador legado inválido.");
    if (memberLegacyId !== undefined && !/^\d+$/.test(memberLegacyId))
      fail("INVALID_LEGACY_ID", "Identificador del socio inválido.");
    try {
      const response = await this.fetcher(
        new URL("/api/Empresa/EvaluateObj", this.config.baseUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo,
            cmd:
              `[ID]=${id}` +
              (memberLegacyId
                ? ` And Integrantes[Socio.ID = ${memberLegacyId}].Count() > 0`
                : ""),
            campos: fields.join(";"),
          }),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
      if (!response.ok) throw new Error("legacy HTTP");
      const body: unknown = await response.json();
      const row =
        Array.isArray(body) && Array.isArray(body[0]) && body.length === 1
          ? body[0]
          : body;
      if (
        !Array.isArray(row) ||
        row.length !== fields.length ||
        String(row[0]) !== id ||
        row.some(
          (value) =>
            value !== null && !["string", "number"].includes(typeof value),
        )
      )
        throw new Error("legacy shape");
      return row;
    } catch {
      return fail(
        "CORE_UNAVAILABLE",
        "No se pudo validar la respuesta financiera del core.",
        503,
      );
    }
  }
  async loan(id: string, memberLegacyId: string): Promise<LoanFinancials> {
    const row = await this.row(
      "F.Module.Cuentas.Prestamos.Prestamo",
      id,
      [
        "ID",
        "LineaPrestamo.ID",
        "[CBU transferencia]",
        "[Bco CMF]",
        "[Bco Coinag Cba]",
        "[Monto En Mano]",
      ],
      memberLegacyId,
    );
    // Above this conservative numeric bound JSON numbers may lose cent precision.
    // Large amounts must be serialized as decimal strings by the core.
    for (const value of row.slice(3, 6)) {
      if (
        typeof value === "number" &&
        (!Number.isFinite(value) || Math.abs(value) > 1e12)
      )
        fail(
          "INVALID_AMOUNT",
          "El core debe expresar importes grandes como texto decimal.",
        );
    }
    const member = await this.creditor(memberLegacyId);
    return {
      loanId: String(row[0]),
      lineId: String(row[1] ?? ""),
      cbu: String(row[2] ?? ""),
      cmf: String(row[3] ?? ""),
      coinag: String(row[4] ?? ""),
      cashInHand: String(row[5] ?? ""),
      memberCuit: member.cuit,
    };
  }
  async creditor(id: string) {
    const row = await this.row("F.Module.SocioMutual", id, ["ID", "CUIT"]);
    return { cuit: String(row[1] ?? "") };
  }
}
