type Solicitud = {
  lineaPrestamoLegacyOid: string | null;
  titular: { nroDocumento: string | null; tipoDocumento: string | null };
};

export type DatosRapidosGateway = {
  lookupSocioRapido(
    documento: string,
    tipoDocumento?: string,
  ): Promise<{ id: string }[]>;
  getConvenioRapido(lineaOid: string): Promise<string | null>;
  getCreditosVigentesRapido(socioId: string): Promise<boolean | null>;
};

export class GetDatosRapidosUseCase {
  private readonly gateway: DatosRapidosGateway;

  constructor(gateway: DatosRapidosGateway) {
    this.gateway = gateway;
  }

  private async resolveSocio(solicitud: Solicitud) {
    const documento =
      solicitud.titular.nroDocumento?.replace(/[.\s-]/g, "") ?? "";
    if (!/^\d+$/.test(documento)) return { condicion: "unknown" as const };
    const matches = await this.gateway.lookupSocioRapido(
      documento,
      solicitud.titular.tipoDocumento?.trim().toUpperCase() || undefined,
    );
    if (matches.length === 0) return { condicion: "none" as const };
    if (matches.length !== 1) return { condicion: "unknown" as const };
    return { condicion: "member" as const, id: matches[0].id };
  }

  async socio(solicitud: Solicitud) {
    try {
      const result = await this.resolveSocio(solicitud);
      return { condicion: result.condicion };
    } catch {
      return { condicion: "unknown" as const };
    }
  }

  async convenio(solicitud: Solicitud) {
    try {
      return {
        descripcion: solicitud.lineaPrestamoLegacyOid
          ? await this.gateway.getConvenioRapido(
              solicitud.lineaPrestamoLegacyOid,
            )
          : null,
      };
    } catch {
      return { descripcion: null };
    }
  }

  async creditos(solicitud: Solicitud) {
    try {
      const socio = await this.resolveSocio(solicitud);
      if (socio.condicion !== "member") return { vigentes: null };
      return {
        vigentes: await this.gateway.getCreditosVigentesRapido(socio.id),
      };
    } catch {
      return { vigentes: null };
    }
  }
}
