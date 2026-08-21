export type LegacyLineaPrestamo = {
  descripcion: string;
  legacyOid: string;
  vigente: boolean;
};

export type LineasPrestamoCatalog = {
  findByLegacyUserAndOid(
    legacyUser: string,
    oid: string,
  ): Promise<LegacyLineaPrestamo | null>;
};
