import { LegacyServiceUnavailableError } from "../../domain/auth-errors";
import type {
  LegacyUserVerification,
  LegacyUserVerifier,
} from "../../domain/services/LegacyUserVerifier";

type EvaluateListPrimitive = boolean | null | number | string;
type EvaluateListRow = EvaluateListPrimitive[];

type EvaluateListLegacyUserVerifierConfig = {
  baseUrl: string;
  timeoutMs: number;
};

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

const LEGACY_USER_FIELDS = "ID;Activo;UserName";

export class EvaluateListLegacyUserVerifier implements LegacyUserVerifier {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(
    config: EvaluateListLegacyUserVerifierConfig,
    fetcher: Fetcher = fetch,
  ) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  async verifyByUserName(
    userName: string,
  ): Promise<LegacyUserVerification | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(this.buildEvaluateListUrl(), {
        body: JSON.stringify({
          campos: LEGACY_USER_FIELDS,
          cmd: `UserName = '${this.escapeLegacyString(userName)}'`,
          max: 500,
          tipo: "ClasesBase.Usuario",
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new LegacyServiceUnavailableError();
      }

      return this.mapResponse(await response.json(), userName);
    } catch (error) {
      if (error instanceof LegacyServiceUnavailableError) {
        throw error;
      }

      throw new LegacyServiceUnavailableError();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildEvaluateListUrl() {
    return new URL("/api/Empresa/EvaluateList", this.baseUrl).toString();
  }

  private escapeLegacyString(value: string) {
    return value.replaceAll("'", "''");
  }

  private mapResponse(
    response: unknown,
    expectedUserName: string,
  ): LegacyUserVerification | null {
    if (!Array.isArray(response)) {
      throw new LegacyServiceUnavailableError();
    }

    const matchingRow = response.find((row): row is EvaluateListRow => {
      if (!Array.isArray(row)) {
        return false;
      }

      return this.getUserName(row).toLowerCase() === expectedUserName.toLowerCase();
    });

    if (!matchingRow) {
      return null;
    }

    const id = this.getId(matchingRow);

    if (id === null) {
      throw new LegacyServiceUnavailableError();
    }

    return {
      active: this.getActive(matchingRow),
      id,
      userName: this.getUserName(matchingRow),
    };
  }

  private getId(row: EvaluateListRow) {
    const value = row[0];

    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string" && value.trim() !== "") {
      const parsedValue = Number(value);
      return Number.isNaN(parsedValue) ? null : parsedValue;
    }

    return null;
  }

  private getActive(row: EvaluateListRow) {
    const value = row[1];

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return value === 1;
    }

    if (typeof value === "string") {
      const normalizedValue = value.trim().toLowerCase();
      return normalizedValue === "true" || normalizedValue === "1";
    }

    return false;
  }

  private getUserName(row: EvaluateListRow) {
    const value = row[2];

    return typeof value === "string" ? value : "";
  }
}
