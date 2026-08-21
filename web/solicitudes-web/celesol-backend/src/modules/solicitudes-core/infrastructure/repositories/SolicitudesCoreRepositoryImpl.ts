import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudesCorePrismaDatasource } from "../datasources/SolicitudesCorePrismaDatasource";

export class SolicitudesCoreRepositoryImpl implements SolicitudesCoreRepository {
  private readonly datasource: SolicitudesCorePrismaDatasource;

  constructor(datasource: SolicitudesCorePrismaDatasource) {
    this.datasource = datasource;
  }

  assignToUserIfUnassigned(
    input: {
      actorUserId: string;
      allowReassignment?: boolean;
      solicitudId: string;
      assignedToUserId: string;
    },
  ) {
    return this.datasource.assignToUserIfUnassigned(input);
  }

  create(input: Parameters<SolicitudesCoreRepository["create"]>[0]) {
    return this.datasource.create(input);
  }

  findById(id: string) {
    return this.datasource.findById(id);
  }

  findByLegacyOid(legacyOid: string) {
    return this.datasource.findByLegacyOid(legacyOid);
  }

  findWorkflowOwnerCodeById(id: string) {
    return this.datasource.findWorkflowOwnerCodeById(id);
  }

  findUserById(id: string) {
    return this.datasource.findUserById(id);
  }

  listUsersByWorkflowOwnerId(workflowOwnerId?: string) {
    return this.datasource.listUsersByWorkflowOwnerId(workflowOwnerId);
  }

  listByOwner(
    input: Parameters<SolicitudesCoreRepository["listByOwner"]>[0],
  ) {
    return this.datasource.listByOwner(input);
  }

  listHistoricas(
    input: NonNullable<
      Parameters<NonNullable<SolicitudesCoreRepository["listHistoricas"]>>[0]
    >,
  ) {
    return this.datasource.listHistoricas(input);
  }

  listRecientes(
    input: NonNullable<
      Parameters<NonNullable<SolicitudesCoreRepository["listRecientes"]>>[0]
    >,
  ) {
    return this.datasource.listRecientes(input);
  }

  listTracking(
    input: NonNullable<
      Parameters<NonNullable<SolicitudesCoreRepository["listTracking"]>>[0]
    >,
  ) {
    return this.datasource.listTracking(input);
  }

  getStats(
    input: Parameters<NonNullable<SolicitudesCoreRepository["getStats"]>>[0],
  ) {
    return this.datasource.getStats(input);
  }

  getVendedorStats(
    input: Parameters<NonNullable<SolicitudesCoreRepository["getVendedorStats"]>>[0],
  ) {
    return this.datasource.getVendedorStats(input);
  }

  getAnalistaStats(
    input: Parameters<NonNullable<SolicitudesCoreRepository["getAnalistaStats"]>>[0],
  ) {
    return this.datasource.getAnalistaStats(input);
  }

  getAnalistaStatsV2(
    input: Parameters<NonNullable<SolicitudesCoreRepository["getAnalistaStatsV2"]>>[0],
  ) {
    return this.datasource.getAnalistaStatsV2(input);
  }

  update(
    id: string,
    patch: Parameters<SolicitudesCoreRepository["update"]>[1],
  ) {
    return this.datasource.update(id, patch);
  }
}
