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
  getMoraRapido(socioId: string): Promise<boolean | null>;
  getCreditosActivosRapido(socioId: string): Promise<boolean | null>;
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

  async mora(solicitud: Solicitud) {
    try {
      const socio = await this.resolveSocio(solicitud);
      if (socio.condicion !== "member") return { enMora: null };
      return { enMora: await this.gateway.getMoraRapido(socio.id) };
    } catch {
      return { enMora: null };
    }
  }

  async creditos(solicitud: Solicitud) {
    try {
      const socio = await this.resolveSocio(solicitud);
      if (socio.condicion !== "member") return { activos: null };
      return {
        activos: await this.gateway.getCreditosActivosRapido(socio.id),
      };
    } catch {
      return { activos: null };
    }
  }
}
