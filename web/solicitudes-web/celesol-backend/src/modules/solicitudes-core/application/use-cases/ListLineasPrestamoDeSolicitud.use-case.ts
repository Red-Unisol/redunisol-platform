import type { LineaPrestamoPresolicitud } from "../../../solicitudes/domain/entities/Solicitud.entity";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { LineasPrestamoCatalog } from "../../domain/services/LineasPrestamoCatalog";

type Dependencies = {
  lineasPrestamoCatalog: Pick<LineasPrestamoCatalog, "listVigentesByLegacyUser">;
  repository: Pick<
    SolicitudesCoreRepository,
    "findById" | "findVendedorLegacyUser"
  >;
};

export type ListLineasPrestamoDeSolicitudInput = {
  solicitudId: string;
};

/**
 * Lineas que se le pueden asignar a una solicitud: las del agente de su
 * vendedor, las mismas que tuvo para elegir al cargarla. No dependen de quien
 * la mira (RIESGO, un admin).
 */
export class ListLineasPrestamoDeSolicitudUseCase {
  private readonly lineasPrestamoCatalog: Dependencies["lineasPrestamoCatalog"];
  private readonly repository: Dependencies["repository"];

  constructor(dependencies: Dependencies) {
    this.lineasPrestamoCatalog = dependencies.lineasPrestamoCatalog;
    this.repository = dependencies.repository;
  }

  async execute(
    input: ListLineasPrestamoDeSolicitudInput,
  ): Promise<LineaPrestamoPresolicitud[]> {
    const solicitud = await this.repository.findById(input.solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    const vendedorLegacyUser = await this.repository.findVendedorLegacyUser?.(
      solicitud.id,
    );

    if (!vendedorLegacyUser || !this.lineasPrestamoCatalog.listVigentesByLegacyUser) {
      return [];
    }

    return this.lineasPrestamoCatalog.listVigentesByLegacyUser(
      vendedorLegacyUser,
    );
  }
}
