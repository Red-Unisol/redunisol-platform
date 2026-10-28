import { randomUUID } from "node:crypto";

import type { SolicitudAdjuntoRepository } from "../../adjuntos/domain/repositories/SolicitudAdjuntoRepository";
import type { AdjuntosObjectStorage } from "../../adjuntos/domain/services/AdjuntosObjectStorage";
import type { CuotaCobradaLegacy } from "../../infrastructure/services/CobrarPrestamoGateway";
import type { ComprobanteRefinanciacionService } from "./ComprobanteRefinanciacion";

type Dependencies = {
  adjuntos: Pick<SolicitudAdjuntoRepository, "create">;
  bucket: string;
  comprobante: Pick<ComprobanteRefinanciacionService, "armar">;
  storage: Pick<AdjuntosObjectStorage, "uploadObject">;
};

export type ArchivarComprobanteRefinanciacionInput = {
  actorId: string | null;
  cobroId: string;
  cuotas: CuotaCobradaLegacy[];
  prestamoId: string;
  solicitudId: string;
};

/**
 * Guarda en los adjuntos de la solicitud el comprobante de un cobro de la
 * refinanciacion, como lo hacen a mano los analistas con el "Prestamos
 * Pagos" que les da Vimarx al cobrar desde la pantalla.
 */
export class ArchivarComprobanteRefinanciacion {
  constructor(private readonly dependencies: Dependencies) {}

  async execute(input: ArchivarComprobanteRefinanciacionInput): Promise<void> {
    const pdf = await this.dependencies.comprobante.armar({
      prestamos: [
        {
          cuotas: input.cuotas,
          numero: input.cobroId,
          prestamoId: input.prestamoId,
        },
      ],
      simulacion: false,
      solicitudId: input.solicitudId,
    });
    const adjuntoId = randomUUID();
    const key = `solicitudes/${input.solicitudId}/adjuntos/refinanciacion-${input.cobroId}-${adjuntoId}.pdf`;

    await this.dependencies.storage.uploadObject({
      body: pdf,
      bucket: this.dependencies.bucket,
      contentType: "application/pdf",
      key,
    });
    await this.dependencies.adjuntos.create({
      adicional: null,
      adjuntoId,
      archivoMimeType: "application/pdf",
      archivoNombre: `Prestamos Pagos - Refinanciacion ${input.cobroId}.pdf`,
      archivoPath: key,
      archivoSizeBytes: pdf.length,
      comentario: `Cuotas ${input.cuotas.map((cuota) => cuota.nroCuota).join(", ")}.`,
      descripcion: `Comprobante de refinanciación: cobro ${input.cobroId} del préstamo ${input.prestamoId} en Vimarx`,
      estadoAdjunto: null,
      nroDocumento: null,
      restringido: false,
      solicitudId: input.solicitudId,
      storageBucket: this.dependencies.bucket,
      tipoAdjunto: "Documentación Adicional",
      uploadedBy: input.actorId,
    });
  }
}
