import { SolicitudRefinanciacionInvalidaError } from "../../domain/solicitudes-core-errors";
import type { ComprobanteRefinanciacionService } from "../services/ComprobanteRefinanciacion";
import type {
  SimularRefinanciacionInput,
  SimularRefinanciacionUseCase,
} from "./SimularRefinanciacion.use-case";

type Dependencies = {
  comprobante: Pick<ComprobanteRefinanciacionService, "armar">;
  simularRefinanciacion: Pick<SimularRefinanciacionUseCase, "execute">;
};

/**
 * La simulacion que los analistas le muestran al socio: el mismo comprobante
 * del cobro, con "SIMULACION" cruzado y numero 0, como el de Vimarx. Una
 * pagina por prestamo. No escribe nada en Vimarx.
 */
export class DescargarSimulacionRefinanciacionPdfUseCase {
  constructor(private readonly dependencies: Dependencies) {}

  async execute(input: SimularRefinanciacionInput): Promise<Buffer> {
    const simulacion =
      await this.dependencies.simularRefinanciacion.execute(input);
    const rechazo = simulacion.prestamos.find((prestamo) => !prestamo.ok);

    if (rechazo && !rechazo.ok) {
      throw new SolicitudRefinanciacionInvalidaError(
        `Vimarx no acepta la refinanciación del préstamo ${rechazo.prestamoId}: ${rechazo.error}`,
      );
    }

    return this.dependencies.comprobante.armar({
      prestamos: simulacion.prestamos.flatMap((prestamo) =>
        prestamo.ok
          ? [{ cuotas: prestamo.cuotas, numero: "0", prestamoId: prestamo.prestamoId }]
          : [],
      ),
      simulacion: true,
      solicitudId: input.solicitudId,
    });
  }
}
