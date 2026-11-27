import { fail, type FinancialGateway, type LoanFinancials } from "./domain";

const loanType = "F.Module.Cuentas.Prestamos.Prestamo";
const beexCancellationScope =
  "[LineaPrestamo.ID] In (2704,2705) And [Solicitud] Is Null And [Bco Coinag Cba] < 0 And [Bco CMF] = 0";

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
    criteria?: string,
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
                : "") +
              (criteria ? ` And (${criteria})` : ""),
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
  async loan(
    id: string,
    memberLegacyId: string,
    hasCancellations = false,
  ): Promise<LoanFinancials> {
    const bankFields = [
      "ID",
      "LineaPrestamo.ID",
      "[Bco CMF]",
      "[Bco Coinag Cba]",
    ];
    const fields = [...bankFields, "[Monto En Mano]"];
    if (hasCancellations) fields.push(`Iif(${beexCancellationScope},1,0)`);
    let row = await this.row(loanType, id, fields, memberLegacyId);
    let cancellationCents: string | undefined;
    if (hasCancellations && !["0", "1"].includes(String(row[5])))
      return fail(
        "CORE_UNAVAILABLE",
        "El core no pudo identificar el origen de la cancelación.",
        503,
      );
    if (hasCancellations && String(row[5]) === "1") {
      // Evaluate the active stored expression even on core instances whose loan
      // metadata has not yet discovered the new calculated property.
      const [, formula] = await this.row(
        "ClasesBase.FormulaAlmacenada",
        "284",
        ["ID", "Formula"],
        undefined,
        `[Activo]=True And [Descripcion]='Monto En Mano Beex' And [Tipo]='${loanType}'`,
      );
      if (
        typeof formula !== "string" ||
        !formula.trim() ||
        formula.includes(";")
      )
        return fail(
          "CORE_UNAVAILABLE",
          "La fórmula Monto En Mano Beex no está disponible.",
          503,
        );
      row = await this.row(
        loanType,
        id,
        [...bankFields, formula, "NroLote"],
        memberLegacyId,
        beexCancellationScope,
      );
      cancellationCents = String(row[5] ?? "");
      if (
        !/^\d+$/.test(cancellationCents) ||
        (typeof row[5] === "number" && !Number.isSafeInteger(row[5]))
      )
        return fail(
          "INVALID_AMOUNT",
          "El lote debe expresar la cancelación en centavos enteros.",
        );
    }
    // Above this conservative numeric bound JSON numbers may lose cent precision.
    // Large amounts must be serialized as decimal strings by the core.
    for (const value of row.slice(2, 5)) {
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
      cmf: String(row[2] ?? ""),
      coinag: String(row[3] ?? ""),
      cashInHand: String(row[4] ?? ""),
      cancellationCents,
      memberCuit: member.cuit,
    };
  }
  async creditor(id: string) {
    const row = await this.row("F.Module.SocioMutual", id, ["ID", "CUIT"]);
    return { cuit: String(row[1] ?? "") };
  }
}
