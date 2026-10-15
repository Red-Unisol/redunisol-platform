import type { VisibilidadVendedorResolver } from "../../domain/services/VisibilidadVendedorResolver";

type EvaluatePrimitive = boolean | null | number | string;

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

type Config = {
  baseUrl: string;
  timeoutMs: number;
  /** Cuanto se recuerda el resultado por usuario. */
  ttlMs?: number;
};

type Dependencies = {
  /** Ids de usuarios de Sol Web con alguno de esos usuarios de Vimarx. */
  buscarIdsPorLegacyUsers: (legacyUsers: string[]) => Promise<string[]>;
  fetcher?: Fetcher;
  now?: () => number;
};

const EVALUATE_LIST_PATH = "/api/Empresa/EvaluateList";
const TTL_POR_DEFECTO_MS = 10 * 60 * 1000;

/**
 * Resuelve el equipo de un vendedor con Vimarx (solo lectura): si su usuario
 * es dueño de algun AgenteSolicitud, suma a los vendedores de esos agentes.
 *
 * El resultado se recuerda unos minutos para no consultar Vimarx en cada
 * pantalla: un cambio de agente en Vimarx tarda eso en verse.
 *
 * Si Vimarx no responde, el vendedor ve solo lo suyo (y no se recuerda, para
 * reintentar en el pedido siguiente): ante la duda, mostrar de menos.
 */
export class VimarxVisibilidadVendedorResolver
  implements VisibilidadVendedorResolver
{
  private readonly cache = new Map<string, { creadores: string[]; expira: number }>();
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    private readonly config: Config,
    private readonly dependencies: Dependencies,
  ) {
    this.fetcher = dependencies.fetcher ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.ttlMs = config.ttlMs ?? TTL_POR_DEFECTO_MS;
  }

  async creadoresVisibles(usuario: { id: string; legacyUser: string }) {
    const legacyUser = usuario.legacyUser.trim();
    const clave = `${usuario.id}:${legacyUser.toLowerCase()}`;
    const guardado = this.cache.get(clave);

    if (guardado && guardado.expira > this.now()) {
      return guardado.creadores;
    }

    let creadores: string[];

    try {
      creadores = await this.resolver(usuario.id, legacyUser);
    } catch {
      return [usuario.id];
    }

    this.cache.set(clave, { creadores, expira: this.now() + this.ttlMs });
    return creadores;
  }

  private async resolver(id: string, legacyUser: string) {
    if (!legacyUser) {
      return [id];
    }

    const agentes = await this.evaluateList(
      "PreSolicitud.Module.AgenteSolicitud",
      `[Usuario.UserName] = '${escapar(legacyUser)}'`,
      "ID",
      100,
    );
    const idsAgentes = agentes
      .map((fila) => fila[0])
      .filter((valor): valor is number => Number.isInteger(valor));

    if (idsAgentes.length === 0) {
      return [id];
    }

    const vendedores = await this.evaluateList(
      "PreSolicitud.Module.VendedorSolicitud",
      `[Agente.ID] In (${idsAgentes.join(", ")}) AND [Usuario] Is Not Null`,
      "Usuario.UserName",
      2000,
    );
    const legacyUsers = Array.from(
      new Set(
        vendedores
          .map((fila) => fila[0])
          .filter((valor): valor is string => typeof valor === "string")
          .map((valor) => valor.trim())
          .filter(Boolean),
      ),
    );
    const ids =
      legacyUsers.length > 0
        ? await this.dependencies.buscarIdsPorLegacyUsers(legacyUsers)
        : [];

    return Array.from(new Set([id, ...ids]));
  }

  private async evaluateList(
    tipo: string,
    cmd: string,
    campos: string,
    max: number,
  ): Promise<EvaluatePrimitive[][]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetcher(
        new URL(EVALUATE_LIST_PATH, this.config.baseUrl),
        {
          body: JSON.stringify({ campos, cmd, max, tipo }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error("Vimarx respondio con error.");
      }

      const body = await response.json();

      if (!Array.isArray(body) || !body.every(Array.isArray)) {
        throw new Error("Respuesta de Vimarx inesperada.");
      }

      return body as EvaluatePrimitive[][];
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// Los valores se interpolan en la expresion de criterios de Vimarx.
function escapar(valor: string) {
  return valor.replaceAll("'", "''");
}
