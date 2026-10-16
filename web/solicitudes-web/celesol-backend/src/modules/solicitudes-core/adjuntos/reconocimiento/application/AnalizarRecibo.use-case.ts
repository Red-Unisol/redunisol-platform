import type {
  ConfiguracionReconocimientoRepository,
  ArchivoReconocimiento,
  ReconocimientoReciboGateway,
  ResultadoReconocimiento,
} from "../domain/ReconocimientoRecibo";
import { validateAdjuntoFile } from "../../application/services/validateAdjuntoFile";
export class AnalizarReciboUseCase {
  constructor(
    private readonly dependencies: {
      configuracion: ConfiguracionReconocimientoRepository;
      gateway: ReconocimientoReciboGateway;
      allowedExtensions: string[];
      allowedMimeTypes: string[];
      maxFileSizeBytes: number;
    },
  ) {}
  async execute(
    file: ArchivoReconocimiento,
    signal?: AbortSignal,
  ): Promise<ResultadoReconocimiento> {
    validateAdjuntoFile(file, this.dependencies);
    const config = await this.dependencies.configuracion.get();
    if (!config.habilitado)
      return { resultado: "deshabilitado", version: config.version };
    signal?.throwIfAborted();
    let result: Omit<ResultadoReconocimiento, "version">;
    try {
      result = await this.dependencies.gateway.reconocer(file, signal);
    } catch {
      // Un fallo del proveedor solo afecta esta sugerencia opcional.
      result = { resultado: "error", motivo: "proveedor" };
    }
    const actual = await this.dependencies.configuracion.get();
    if (!actual.habilitado || actual.version !== config.version)
      return { resultado: "deshabilitado", version: actual.version };
    return { ...result, version: actual.version };
  }
}
