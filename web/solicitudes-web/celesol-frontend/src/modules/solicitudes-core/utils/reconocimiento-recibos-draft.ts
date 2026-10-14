export type EstadoAnalisis =
  | "analizando"
  | "recibo"
  | "manual"
  | "error"
  | "error_credencial"
  | "deshabilitado";
type Config = { habilitado: boolean; version: number };
type Result = {
  resultado:
    | "recibo"
    | "no_recibo"
    | "indeterminado"
    | "error"
    | "deshabilitado";
  version: number;
  motivo?: string;
};
type Job = { controller: AbortController; version?: number };
/** Cada selección crea una tarea propia. Ningún resultado escribe fuera de ella. */
export class ReconocimientoRecibosDraft {
  private jobs = new Map<string, Job>();
  private readonly service: {
    config: () => Promise<Config>;
    analyze: (file: File, signal: AbortSignal) => Promise<Result>;
  };
  private readonly onStatus: (id: string, estado: EstadoAnalisis) => void;
  constructor(
    service: ReconocimientoRecibosDraft["service"],
    onStatus: ReconocimientoRecibosDraft["onStatus"],
  ) {
    this.service = service;
    this.onStatus = onStatus;
  }
  cancel(id: string) {
    this.jobs.get(id)?.controller.abort();
    this.jobs.delete(id);
  }
  cancelAll(markManual = false) {
    for (const id of this.jobs.keys()) {
      this.cancel(id);
      if (markManual) this.onStatus(id, "manual");
    }
  }
  manual(id: string) {
    this.cancel(id);
    this.onStatus(id, "manual");
  }
  async refreshConfig() {
    const jobs = [...this.jobs];
    if (!jobs.length) return;
    try {
      const config = await this.service.config();
      for (const [id, job] of jobs) {
        // Una consulta atrasada no alcanza tareas nuevas ni versiones posteriores.
        // start valida la configuración de las tareas que todavía no tienen versión.
        if (
          this.jobs.get(id) !== job ||
          job.version === undefined ||
          config.version < job.version
        )
          continue;
        if (!config.habilitado || job.version !== config.version) {
          this.cancel(id);
          this.onStatus(id, "deshabilitado");
        }
      }
    } catch {
      /* El endpoint de análisis vuelve a verificar; no inventar configuración. */
    }
  }
  start(id: string, file: File, onDetected: () => void) {
    this.cancel(id);
    const job: Job = { controller: new AbortController() };
    this.jobs.set(id, job);
    const current = () =>
      this.jobs.get(id) === job && !job.controller.signal.aborted;
    this.onStatus(id, "analizando");
    void (async () => {
      try {
        const config = await this.service.config();
        if (!current()) return;
        job.version = config.version;
        if (!config.habilitado) {
          this.onStatus(id, "deshabilitado");
          return;
        }
        const result = await this.service.analyze(file, job.controller.signal);
        if (!current()) return;
        // Releer antes de aplicar: no completar tras desactivar ni reactivar.
        const actual = await this.service.config();
        if (!current()) return;
        if (
          !actual.habilitado ||
          actual.version !== config.version ||
          result.version !== config.version ||
          result.resultado === "deshabilitado"
        ) {
          this.onStatus(id, "deshabilitado");
          return;
        }
        if (result.resultado === "recibo") {
          onDetected();
          this.onStatus(id, "recibo");
        } else
          this.onStatus(
            id,
            result.resultado === "error"
              ? result.motivo === "credencial"
                ? "error_credencial"
                : "error"
              : "manual",
          );
      } catch {
        if (current()) this.onStatus(id, "error");
      } finally {
        if (current()) this.jobs.delete(id);
      }
    })();
  }
}
export const mensajesAnalisis: Record<EstadoAnalisis, string> = {
  analizando: "Analizando documento…",
  recibo: "Recibo de sueldo detectado",
  manual: "Seleccioná el tipo de adjunto manualmente",
  error:
    "No se pudo reconocer automáticamente. Seleccioná el tipo manualmente para continuar.",
  error_credencial:
    "Reconocimiento automático no disponible. Podés clasificar y guardar el adjunto manualmente.",
  deshabilitado: "Reconocimiento desactivado. Seleccioná el tipo manualmente",
};
