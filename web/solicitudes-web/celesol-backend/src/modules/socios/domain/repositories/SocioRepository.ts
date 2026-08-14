import type { Socio } from "../entities/Socio.entity";
import type { CreateSocioData, UpdateSocioData } from "../types/SocioRepositoryData";

export type ListSociosInput = {
  limit: number;
  offset: number;
  search?: string;
};

export interface SocioRepository {
  create(input: CreateSocioData): Promise<Socio>;
  delete(id: string): Promise<void>;
  findByCuit(cuit: string, excludeId?: string): Promise<Socio | null>;
  findByDocumento(
    nroDocumento: string,
    excludeId?: string,
  ): Promise<Socio | null>;
  findById(id: string): Promise<Socio | null>;
  list(input: ListSociosInput): Promise<Socio[]>;
  lookupByDocumento(
    documento: string,
    tipoDocumento?: string,
  ): Promise<Socio[]>;
  update(id: string, input: UpdateSocioData): Promise<Socio>;
}
