import type { CalculadoraMutualDatos } from "../../domain/entities/CalculadoraMutual.entity";
import { SolicitudNotFoundError } from "../../domain/riesgo-errors";
import type { SolicitudCoreSnapshotDatasource } from "../../infrastructure/datasources/SolicitudCoreSnapshotDatasource";
import type { CalculadoraMutualLegacyGateway } from "../../infrastructure/services/CalculadoraMutualLegacyGateway";

type Dependencies = {
  legacyGateway: CalculadoraMutualLegacyGateway;
  solicitudCoreSnapshotDatasource: SolicitudCoreSnapshotDatasource;
};

/**
 * Híbrido: si la solicitud ya existe en el core (Postgres) por su legacyOid,
 * usa esos datos para el snapshot (línea, montos, titular, etc.) sin ir al
 * legado. El historial de riesgo del socio (Situación, Rechazos, Titular
 * Nuevo, Saldo y Compromiso de préstamos) siempre se busca por CUIT en el
 * legado, porque el core nunca lo tiene, sea cual sea el origen del
 * snapshot.
 *
 * Si la solicitud no existe en el core (caso de hoy: legacyOid nunca se
 * completa todavía), cae por completo al legado como hasta ahora.
 */
export class CalculadoraMutualDatosProvider {
  private readonly legacyGateway: CalculadoraMutualLegacyGateway;
  private readonly solicitudCoreSnapshotDatasource: SolicitudCoreSnapshotDatasource;

  constructor(dependencies: Dependencies) {
    this.legacyGateway = dependencies.legacyGateway;
    this.solicitudCoreSnapshotDatasource =
      dependencies.solicitudCoreSnapshotDatasource;
  }

  async getDatos(oid: string): Promise<CalculadoraMutualDatos> {
    const coreSnapshot =
      await this.solicitudCoreSnapshotDatasource.findByLegacyOid(oid);

    if (!coreSnapshot) {
      return this.legacyGateway.getDatos(oid);
    }

    const historial = await this.legacyGateway.getHistorialByCuit(
      coreSnapshot.cuitTitular,
      coreSnapshot.fechaSolicitud,
    );

    return {
      ...coreSnapshot,
      ...historial,
    };
  }

  /**
   * Para la pestaña "Calculadora" embebida en el detalle de una solicitud
   * del core: ya sabemos qué solicitud es (su id propio), así que se busca
   * directo ahí, sin pasar por legacyOid. El historial de riesgo del socio
   * sigue yendo al legado por CUIT, como siempre.
   */
  async getDatosByCoreId(solicitudId: string): Promise<CalculadoraMutualDatos> {
    const coreSnapshot =
      await this.solicitudCoreSnapshotDatasource.findById(solicitudId);

    if (!coreSnapshot) {
      throw new SolicitudNotFoundError();
    }

    const historial = await this.legacyGateway.getHistorialByCuit(
      coreSnapshot.cuitTitular,
      coreSnapshot.fechaSolicitud,
    );

    return {
      ...coreSnapshot,
      ...historial,
    };
  }
}
