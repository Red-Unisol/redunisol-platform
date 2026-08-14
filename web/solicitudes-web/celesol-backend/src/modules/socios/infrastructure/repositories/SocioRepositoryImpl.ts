import type { SocioCountRepository } from "../../domain/repositories/SocioCountRepository";
import type { SocioLegacySyncRepository } from "../../domain/repositories/SocioLegacySyncRepository";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";
import type { SociosPrismaDatasource } from "../datasources/SociosPrismaDatasource";

export class SocioRepositoryImpl
  implements SocioRepository, SocioLegacySyncRepository, SocioCountRepository
{
  private readonly datasource: SociosPrismaDatasource;

  constructor(datasource: SociosPrismaDatasource) {
    this.datasource = datasource;
  }

  count(input: Parameters<SocioCountRepository["count"]>[0]) {
    return this.datasource.count(input);
  }

  create(input: Parameters<SocioRepository["create"]>[0]) {
    return this.datasource.create(input);
  }

  delete(id: string) {
    return this.datasource.delete(id);
  }

  findByCuit(cuit: string, excludeId?: string) {
    return this.datasource.findByCuit(cuit, excludeId);
  }

  findByDocumento(nroDocumento: string, excludeId?: string) {
    return this.datasource.findByDocumento(nroDocumento, excludeId);
  }

  findById(id: string) {
    return this.datasource.findById(id);
  }

  list(input: Parameters<SocioRepository["list"]>[0]) {
    return this.datasource.list(input);
  }

  lookupByDocumento(
    documento: string,
    tipoDocumento?: string,
  ) {
    return this.datasource.lookupByDocumento(documento, tipoDocumento);
  }

  update(id: string, input: Parameters<SocioRepository["update"]>[1]) {
    return this.datasource.update(id, input);
  }

  upsertManyFromLegacy(
    rows: Parameters<SocioLegacySyncRepository["upsertManyFromLegacy"]>[0],
  ) {
    return this.datasource.upsertManyFromLegacy(rows);
  }
}
