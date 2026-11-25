import type { LineaPrestamoPresolicitud } from "../../../solicitudes/domain/entities/Solicitud.entity";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import { isAmejucaLineAvailable, type AmejucaVariant } from "../../domain/services/AmejucaLineAvailability";
import type { LineasPrestamoCatalog } from "../../domain/services/LineasPrestamoCatalog";

// Required: si el repositorio no expone findVendedorLegacyUser, que falle el
// typecheck y no una lista vacia en silencio (paso con el #433).
type Dependencies = {
  getAmejucaVariant: () => Promise<AmejucaVariant>;
  lineasPrestamoCatalog: Required<
    Pick<LineasPrestamoCatalog, "listVigentesByLegacyUser">
  >;
  repository: Required<
    Pick<SolicitudesCoreRepository, "findById" | "findVendedorLegacyUser">
  >;
};

export type ListLineasPrestamoDeSolicitudInput = {
  solicitudId: string;
};

/**
 * Líneas del agente del vendedor para simular y editar la solicitud.
 * La línea actual se puede conservar aunque haya cambiado la variante activa.
 */
export class ListLineasPrestamoDeSolicitudUseCase {
  private readonly getAmejucaVariant: Dependencies["getAmejucaVariant"];
  private readonly lineasPrestamoCatalog: Dependencies["lineasPrestamoCatalog"];
  private readonly repository: Dependencies["repository"];

  constructor(dependencies: Dependencies) {
    this.lineasPrestamoCatalog = dependencies.lineasPrestamoCatalog;
    this.repository = dependencies.repository;
    this.getAmejucaVariant = dependencies.getAmejucaVariant;
  }

  async execute(
    input: ListLineasPrestamoDeSolicitudInput,
  ): Promise<Array<LineaPrestamoPresolicitud & { asignable: boolean }>> {
    const solicitud = await this.repository.findById(input.solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    const vendedorLegacyUser = await this.repository.findVendedorLegacyUser(
      solicitud.id,
    );

    if (!vendedorLegacyUser) {
      return [];
    }

    const [lineas, variant] = await Promise.all([
      this.lineasPrestamoCatalog.listVigentesByLegacyUser(vendedorLegacyUser),
      this.getAmejucaVariant(),
    ]);
    return lineas.map((linea) => ({
      ...linea,
      asignable:
        linea.oid === solicitud.lineaPrestamoLegacyOid ||
        isAmejucaLineAvailable(linea.oid, variant),
    }));
  }
}
