export type CalculadoraRiesgoOrigen = "REPOSITORIO" | "RESTAURADA" | "VIMARX";

/** Datos de una version, sin el archivo: lo que muestra el historial. */
export type CalculadoraRiesgoVersionResumen = {
  cargadaEn: Date;
  cargadaPor: { id: string; nombre: string } | null;
  id: string;
  origen: CalculadoraRiesgoOrigen;
  restauradaDeId: string | null;
  resumenCambios: unknown;
  sha256: string;
  vigente: boolean;
};

export type CalculadoraRiesgoVersionConContenido =
  CalculadoraRiesgoVersionResumen & { contenido: Buffer };

export type GuardarCalculadoraRiesgoVersionInput = {
  cargadaEn: Date;
  /** Null para la version REPOSITORIO, que no trajo nadie. */
  cargadaPorId: string | null;
  contenido: Buffer;
  origen: CalculadoraRiesgoOrigen;
  restauradaDeId: string | null;
  resumenCambios: unknown;
  sha256: string;
};

/** La vigente y las 3 anteriores. */
export const CALCULADORA_VERSIONES_A_CONSERVAR = 4;

export type CalculadoraRiesgoVersionRepository = {
  findVigente(): Promise<CalculadoraRiesgoVersionConContenido | null>;
  findById(id: string): Promise<CalculadoraRiesgoVersionConContenido | null>;
  /** De la mas nueva a la mas vieja. */
  listar(): Promise<CalculadoraRiesgoVersionResumen[]>;
  /**
   * Guarda la version como vigente, deja de serlo la anterior y borra las que
   * pasan de CALCULADORA_VERSIONES_A_CONSERVAR. Todo en una transaccion.
   */
  guardarComoVigente(
    input: GuardarCalculadoraRiesgoVersionInput,
  ): Promise<CalculadoraRiesgoVersionResumen>;
};
