import type { SolicitudCancelacionRepository } from "../../domain/repositories/SolicitudCancelacionRepository";
import type { SolicitudCancelacionesPrismaDatasource } from "../datasources/SolicitudCancelacionesPrismaDatasource";

export class SolicitudCancelacionRepositoryImpl
  implements SolicitudCancelacionRepository
{
  private readonly datasource: SolicitudCancelacionesPrismaDatasource;

  constructor(datasource: SolicitudCancelacionesPrismaDatasource) {
    this.datasource = datasource;
  }

  create(input: Parameters<SolicitudCancelacionRepository["create"]>[0]) {
    return this.datasource.create(input);
  }

  findById(id: string) {
    return this.datasource.findById(id);
  }

  listBySolicitudId(solicitudId: string) {
    return this.datasource.listBySolicitudId(solicitudId);
  }

  softDelete(
    input: Parameters<SolicitudCancelacionRepository["softDelete"]>[0],
  ) {
    return this.datasource.softDelete(input);
  }

  update(input: Parameters<SolicitudCancelacionRepository["update"]>[0]) {
    return this.datasource.update(input);
  }
}
