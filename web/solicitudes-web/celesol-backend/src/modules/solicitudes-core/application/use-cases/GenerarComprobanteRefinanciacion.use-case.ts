import type { ArchivarComprobanteRefinanciacion } from "../services/ArchivarComprobanteRefinanciacion";
import type { ComprobanteRefinanciacionService } from "../services/ComprobanteRefinanciacion";
import { hoyEnArgentina } from "../services/PlanCobroRefinanciacion";
import type {
  GuardarSolicitudRefinanciacionInput,
  GuardarSolicitudRefinanciacionUseCase,
  SolicitudRefinanciacionGuardada,
} from "./GuardarSolicitudRefinanciacion.use-case";

type Dependencies = {
  archivar: Pick<ArchivarComprobanteRefinanciacion, "guardar" | "quitar">;
  comprobante: Pick<ComprobanteRefinanciacionService, "armar">;
  guardar: Pick<GuardarSolicitudRefinanciacionUseCase, "execute">;
  hoy?: () => string;
};

/** Lo que dice el comprobante mientras las cuotas no se cobraron. */
export const NUMERO_PENDIENTE_DE_COBRO = "Pendiente de cobro";

/**
 * El boton "Generar PDF" de la pestaña Refinanciacion: guarda las cuotas
 * elegidas y deja el comprobante en los adjuntos de la solicitud, con los
 * importes de ese dia. Las cuotas se cobran recien al generar el prestamo.
 *
 * Es el momento en que el analista arma la refinanciacion, asi que el PDF
 * queda en el legajo desde ahi (pedido de Nicolas, 28/10/2026). Si las
 * cuotas vencidas siguen sin cobrarse unos dias, el cobro real lleva unos
 * punitorios mas que el PDF. Volver a generarlo reemplaza al anterior; sin
 * cuotas, se quita.
 */
export class GenerarComprobanteRefinanciacionUseCase {
  private readonly hoy: () => string;

  constructor(private readonly dependencies: Dependencies) {
    this.hoy = dependencies.hoy ?? (() => hoyEnArgentina());
  }

  async execute(
    input: GuardarSolicitudRefinanciacionInput,
  ): Promise<SolicitudRefinanciacionGuardada & { adjuntoId: string | null }> {
    // Valida permisos, que los prestamos sean del titular y que Vimarx acepte
    // las cuotas; y las guarda.
    const guardada = await this.dependencies.guardar.execute(input);

    if (!guardada.simulacion || guardada.prestamos.length === 0) {
      await this.dependencies.archivar.quitar({
        actorId: input.currentUser.id,
        motivo: "Se quitó la refinanciación.",
        solicitudId: input.solicitudId,
      });

      return { ...guardada, adjuntoId: null };
    }

    const prestamos = guardada.simulacion.prestamos.flatMap((prestamo) =>
      prestamo.ok
        ? [
            {
              cuotas: prestamo.cuotas,
              numero: NUMERO_PENDIENTE_DE_COBRO,
              prestamoId: prestamo.prestamoId,
            },
          ]
        : [],
    );
    const pdf = await this.dependencies.comprobante.armar({
      prestamos,
      simulacion: false,
      solicitudId: input.solicitudId,
    });
    const [anio, mes, dia] = this.hoy().split("-");
    const { adjuntoId } = await this.dependencies.archivar.guardar({
      actorId: input.currentUser.id,
      descripcion: `Comprobante de refinanciación (préstamos ${prestamos
        .map((prestamo) => prestamo.prestamoId)
        .join(", ")}). Las cuotas se cobran en Vimarx al generar el préstamo.`,
      nombre: `Prestamos Pagos - Refinanciacion ${dia}-${mes}-${anio}.pdf`,
      pdf,
      solicitudId: input.solicitudId,
    });

    return { ...guardada, adjuntoId };
  }
}
