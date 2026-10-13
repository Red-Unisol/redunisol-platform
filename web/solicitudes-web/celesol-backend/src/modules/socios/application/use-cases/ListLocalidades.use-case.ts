import type { LocalidadLegacy } from "../../infrastructure/services/EvaluateListLocalidadesGateway";

type LocalidadesGateway = {
  fetchAll(): Promise<LocalidadLegacy[]>;
};

type Dependencies = {
  cacheTtlMs?: number;
  gateway: LocalidadesGateway;
  now?: () => number;
};

type CachedLocalidad = LocalidadLegacy & {
  normalizedNombre: string;
  searchText: string;
};

const DEFAULT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export type ListLocalidadesInput = {
  ids?: string[];
  limit: number;
  search?: string;
};

/**
 * Localidades de Vimarx para el desplegable del domicilio del socio. La tabla
 * (~22.200 filas) casi no cambia: se trae entera, se guarda en memoria y se
 * busca aca, asi el navegador recibe solo las coincidencias.
 */
export class ListLocalidadesUseCase {
  private readonly cacheTtlMs: number;
  private readonly gateway: LocalidadesGateway;
  private readonly now: () => number;
  private cache: { expiresAt: number; items: CachedLocalidad[] } | null = null;
  private pending: Promise<CachedLocalidad[]> | null = null;

  constructor(dependencies: Dependencies) {
    this.cacheTtlMs = dependencies.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.gateway = dependencies.gateway;
    this.now = dependencies.now ?? Date.now;
  }

  async execute(input: ListLocalidadesInput): Promise<LocalidadLegacy[]> {
    const items = await this.getAll();

    if (input.ids) {
      const ids = new Set(input.ids);
      return items.filter((item) => ids.has(item.id)).map(toLocalidad);
    }

    // Cada palabra tiene que aparecer en nombre, provincia o codigo postal:
    // "alberdi cord" encuentra ALBERDI de CORDOBA. Primero el nombre exacto,
    // despues los que empiezan con lo buscado, despues el resto.
    const search = normalize(input.search ?? "");
    const words = search.split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      return [];
    }

    return items
      .filter((item) => words.every((word) => item.searchText.includes(word)))
      .map((item) => ({ item, rank: rankMatch(item.normalizedNombre, search) }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, input.limit)
      .map(({ item }) => toLocalidad(item));
  }

  private async getAll(): Promise<CachedLocalidad[]> {
    if (this.cache && this.cache.expiresAt > this.now()) {
      return this.cache.items;
    }

    // Si dos usuarios abren el alta a la vez, una sola consulta a Vimarx.
    this.pending ??= this.load().finally(() => {
      this.pending = null;
    });

    return this.pending;
  }

  private async load(): Promise<CachedLocalidad[]> {
    const items = (await this.gateway.fetchAll())
      .map((item) => ({
        ...item,
        normalizedNombre: normalize(item.nombre),
        searchText: normalize(
          [item.nombre, item.provincia, item.codigoPostal].join(" "),
        ),
      }))
      .sort(
        (a, b) =>
          a.nombre.localeCompare(b.nombre, "es") ||
          (a.provincia ?? "").localeCompare(b.provincia ?? "", "es"),
      );

    this.cache = { expiresAt: this.now() + this.cacheTtlMs, items };

    return items;
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function rankMatch(nombre: string, search: string): number {
  if (nombre === search) {
    return 0;
  }

  return nombre.startsWith(search) ? 1 : 2;
}

function toLocalidad(item: CachedLocalidad): LocalidadLegacy {
  return {
    codigoPostal: item.codigoPostal,
    id: item.id,
    nombre: item.nombre,
    provincia: item.provincia,
  };
}
