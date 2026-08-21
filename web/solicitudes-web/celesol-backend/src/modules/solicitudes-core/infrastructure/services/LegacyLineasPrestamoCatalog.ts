import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";
import type { LineasPrestamoCatalog } from "../../domain/services/LineasPrestamoCatalog";

export class LegacyLineasPrestamoCatalog implements LineasPrestamoCatalog {
  private readonly solicitudesLegacyGateway: SolicitudesLegacyGateway;

  constructor(solicitudesLegacyGateway: SolicitudesLegacyGateway) {
    this.solicitudesLegacyGateway = solicitudesLegacyGateway;
  }

  async findByLegacyUserAndOid(legacyUser: string, oid: string) {
    const lineas = await this.solicitudesLegacyGateway.getLineasPrestamoByLegacyUser(
      legacyUser,
    );
    const matched = lineas.find((linea) => linea.oid === oid);

    if (!matched || !matched.oid || !matched.descripcion || matched.vigente !== true) {
      return null;
    }

    return {
      descripcion: matched.descripcion,
      legacyOid: matched.oid,
      vigente: matched.vigente,
    };
  }
}
