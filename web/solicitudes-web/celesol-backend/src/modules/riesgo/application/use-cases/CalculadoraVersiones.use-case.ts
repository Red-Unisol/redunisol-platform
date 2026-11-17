import { createHash } from "node:crypto";

import type {
  CalculadoraRiesgoVersionRepository,
  CalculadoraRiesgoVersionResumen,
} from "../../domain/repositories/CalculadoraRiesgoVersionRepository";
import {
  CalculadoraCambioEnVimarxError,
  CalculadoraVersionNotFoundError,
  CalculadoraVersionYaVigenteError,
} from "../../domain/riesgo-errors";
import { adaptarCalculadoraVimarx } from "../services/AdaptarCalculadoraVimarx";
import {
  type CambiosCalculadora,
  compararCalculadoras,
  sinCambios,
} from "../services/CompararCalculadoras";

type Dependencies = {
  /** La planilla del repo: la que se usa mientras no haya versiones. */
  leerPlanillaRepositorio: () => Promise<Buffer>;
  now: () => Date;
  repository: CalculadoraRiesgoVersionRepository;
  vimarx: { descargar(): Promise<Buffer> };
};

export type VistaPreviaCalculadora = {
  cambios: CambiosCalculadora;
  /** Huella de la planilla de Vimarx revisada: se pide de vuelta al aplicar. */
  huellaVimarx: string;
  sinCambios: boolean;
};

/**
 * Versiones de la calculadora de riesgo: Riesgo trae la ultima SCORINGPF de
 * Vimarx (primero ve que cambia y despues confirma), lista las versiones y
 * puede volver a una anterior.
 */
export class CalculadoraVersionesUseCase {
  private readonly deps: Dependencies;

  constructor(deps: Dependencies) {
    this.deps = deps;
  }

  listar(): Promise<CalculadoraRiesgoVersionResumen[]> {
    return this.deps.repository.listar();
  }

  /** Baja y adapta la planilla de Vimarx y dice que cambia. No guarda nada. */
  async previsualizar(): Promise<VistaPreviaCalculadora> {
    const { cambios, huellaVimarx } = await this.prepararDesdeVimarx();
    return { cambios, huellaVimarx, sinCambios: sinCambios(cambios) };
  }

  /**
   * Vuelve a bajar la planilla y la deja vigente, si es la misma que se
   * reviso en la vista previa. Si no cambia nada, no crea una version.
   */
  async aplicar(input: {
    huellaVimarx: string;
    usuarioId: string;
  }): Promise<CalculadoraRiesgoVersionResumen | null> {
    const preparada = await this.prepararDesdeVimarx();

    if (preparada.huellaVimarx !== input.huellaVimarx) {
      throw new CalculadoraCambioEnVimarxError();
    }
    if (sinCambios(preparada.cambios)) {
      return null;
    }

    await this.guardarRepositorioSiNoHayVersiones(preparada.actual);

    return this.deps.repository.guardarComoVigente({
      cargadaEn: this.deps.now(),
      cargadaPorId: input.usuarioId,
      contenido: preparada.contenido,
      origen: "VIMARX",
      restauradaDeId: null,
      resumenCambios: preparada.cambios,
      sha256: huella(preparada.contenido),
    });
  }

  /** Deja vigente una copia de una version anterior. */
  async restaurar(input: {
    usuarioId: string;
    versionId: string;
  }): Promise<CalculadoraRiesgoVersionResumen> {
    const origen = await this.deps.repository.findById(input.versionId);

    if (!origen) {
      throw new CalculadoraVersionNotFoundError();
    }
    if (origen.vigente) {
      throw new CalculadoraVersionYaVigenteError();
    }

    return this.deps.repository.guardarComoVigente({
      cargadaEn: this.deps.now(),
      cargadaPorId: input.usuarioId,
      contenido: origen.contenido,
      origen: "RESTAURADA",
      restauradaDeId: origen.id,
      // La copiada puede borrarse al rotar: se guarda de cual era.
      resumenCambios: {
        restauradaDe: {
          cargadaEn: origen.cargadaEn.toISOString(),
          cargadaPor: origen.cargadaPor?.nombre ?? null,
          origen: origen.origen,
        },
      },
      sha256: origen.sha256,
    });
  }

  private async prepararDesdeVimarx() {
    const vimarx = await this.deps.vimarx.descargar();
    const vigente = await this.deps.repository.findVigente();
    const actual =
      vigente?.contenido ?? (await this.deps.leerPlanillaRepositorio());
    const { contenido } = await adaptarCalculadoraVimarx(vimarx, actual);
    const cambios = await compararCalculadoras(actual, contenido);

    return { actual, cambios, contenido, huellaVimarx: huella(vimarx) };
  }

  /** La primera vez, la planilla del repo queda como version para poder volver. */
  private async guardarRepositorioSiNoHayVersiones(planillaRepositorio: Buffer) {
    if ((await this.deps.repository.listar()).length > 0) {
      return;
    }

    await this.deps.repository.guardarComoVigente({
      cargadaEn: new Date(this.deps.now().getTime() - 1),
      cargadaPorId: null,
      contenido: planillaRepositorio,
      origen: "REPOSITORIO",
      restauradaDeId: null,
      resumenCambios: null,
      sha256: huella(planillaRepositorio),
    });
  }
}

function huella(contenido: Buffer) {
  return createHash("sha256").update(contenido).digest("hex");
}
