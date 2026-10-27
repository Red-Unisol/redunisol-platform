// Datos del convenio que Vimarx guarda en SocAux del socio, y sus
// observaciones. Mudon = beneficio, AMEJUCA = convAux.
export type ConvenioSocio = {
  beneficio: string | null;
  caja40: number | null;
  convAux: number | null;
  observaciones: string | null;
};

/** Only edited fields, with the value shown when the operator began editing. */
export type ConvenioSocioEdicion = {
  [K in keyof ConvenioSocio]?: {
    original: ConvenioSocio[K];
    valor: ConvenioSocio[K];
  };
};

// Con el NroSocio que conocen los analistas: Sol Web guarda el ID interno
// (socio 1707 = ID 143254).
export type SocioConvenioLegacy = ConvenioSocio & { nroSocio: string | null };

export type ConvenioSocioGateway = {
  // socioLegacyId: ID de F.Module.SocioMutual (nroSocioLegacy en Sol Web).
  getConvenioSocioByLegacyId(
    socioLegacyId: string,
  ): Promise<SocioConvenioLegacy | null>;
};
