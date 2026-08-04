import type { SolicitudAdjuntoRepository } from "../../domain/repositories/SolicitudAdjuntoRepository";
import type { SolicitudAdjuntosPrismaDatasource } from "../datasources/SolicitudAdjuntosPrismaDatasource";

export class SolicitudAdjuntoRepositoryImpl
  implements SolicitudAdjuntoRepository
{
  private readonly datasource: SolicitudAdjuntosPrismaDatasource;

  constructor(datasource: SolicitudAdjuntosPrismaDatasource) {
    this.datasource = datasource;
  }

  create(input: Parameters<SolicitudAdjuntoRepository["create"]>[0]) {
    return this.datasource.create(input);
  }

  createMany(inputs: Parameters<SolicitudAdjuntoRepository["createMany"]>[0]) {
    return this.datasource.createMany(inputs);
  }

  findById(id: string) {
    return this.datasource.findById(id);
  }

  listBySolicitudId(solicitudId: string) {
    return this.datasource.listBySolicitudId(solicitudId);
  }

  softDelete(input: Parameters<SolicitudAdjuntoRepository["softDelete"]>[0]) {
    return this.datasource.softDelete(input);
  }

  update(input: Parameters<SolicitudAdjuntoRepository["update"]>[0]) {
    return this.datasource.update(input);
  }
}
